"""
SecureVote AI — Flask service for face encoding, matching, and blink (liveness) detection.

Endpoints:
  - POST /encode-face: returns a single face encoding for the provided image
  - POST /match-face: compares a known encoding to a live image
  - POST /detect-blink: verifies liveness by detecting blinks across a short frame sequence
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any

import face_recognition
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

# Dependencies:
# - face_recognition (and therefore dlib) is used for biometric matching.
# - Pillow is used for image decoding.
_BIOMETRIC_MODE = "face_recognition"


app = Flask(__name__)

# Backend-to-backend calls do not require CORS, but keeping CORS explicit avoids surprises.
cors_origin = os.getenv("CORS_ORIGIN", "")
if cors_origin:
    CORS(app, resources={r"/*": {"origins": cors_origin}})


def _json() -> dict[str, Any]:
    if not request.is_json:
        return {}
    payload = request.get_json(silent=True) or {}
    return payload if isinstance(payload, dict) else {}


def decode_base64_image(image_b64: str) -> np.ndarray:
    """
    Accepts either raw base64 or a data URL (data:image/jpeg;base64,...).
    Returns an RGB image ndarray suitable for face_recognition.
    """
    if not isinstance(image_b64, str) or not image_b64:
        raise ValueError("image is required")

    # Strip potential data URL prefix.
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        raw = base64.b64decode(image_b64, validate=True)
    except Exception as e:
        raise ValueError("image must be valid base64") from e

    try:
        pil_image = Image.open(io.BytesIO(raw))
    except Exception as e:
        raise ValueError("image could not be decoded") from e

    # Ensure image is in RGB format
    if pil_image.mode != "RGB":
        pil_image = pil_image.convert("RGB")

    return np.array(pil_image)


def _eye_aspect_ratio(eye_points: list[list[int]] | list[tuple[int, int]]) -> float:
    """
    eye_points: 6 points in the order returned by face_recognition landmarks.
    Uses EAR formula: (||p2-p6|| + ||p3-p5||) / (2*||p1-p4||)
    """
    pts = np.asarray(eye_points, dtype=np.float32)
    if pts.shape[0] != 6:
        raise ValueError("eye landmark must contain 6 points")

    p1, p2, p3, p4, p5, p6 = pts
    a = np.linalg.norm(p2 - p6)
    b = np.linalg.norm(p3 - p5)
    c = np.linalg.norm(p1 - p4)
    if c == 0:
        return 0.0
    return float((a + b) / (2.0 * c))


def _extract_ear(rgb_image: np.ndarray) -> float:
    """
    Returns EAR from the first detected face landmarks in the image.
    """
    landmarks_list = face_recognition.face_landmarks(rgb_image)
    if not landmarks_list:
        raise ValueError("no face landmarks found")

    landmarks = landmarks_list[0]
    left_eye = landmarks.get("left_eye")
    right_eye = landmarks.get("right_eye")
    if not left_eye or not right_eye:
        raise ValueError("eye landmarks not found")

    ear_left = _eye_aspect_ratio(left_eye)
    ear_right = _eye_aspect_ratio(right_eye)
    return float((ear_left + ear_right) / 2.0)




@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "service": "ai-service",
            "biometric_mode": _BIOMETRIC_MODE,
        }
    )


@app.route("/encode-face", methods=["POST"])
def encode_face():
    payload = _json()
    image_b64 = payload.get("image") or payload.get("frame")

    try:
        rgb = decode_base64_image(image_b64)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        # face_recognition returns encodings for each detected face.
        locations = face_recognition.face_locations(rgb, model="hog")
        if not locations:
            return jsonify({"error": "no face found"}), 400

        encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)
        if not encodings:
            return jsonify({"error": "face encoding failed"}), 400

        # Use the first face encoding. (Frontend should ensure a single face in frame.)
        encoding = encodings[0].astype(np.float32).tolist()
        return jsonify({"encoding": encoding, "mode": "face_recognition"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/match-face", methods=["POST"])
def match_face():
    payload = _json()
    known_encoding = payload.get("known_encoding")
    image_b64 = payload.get("image") or payload.get("frame")
    threshold = float(payload.get("threshold", os.getenv("MATCH_THRESHOLD", "0.6")))

    if not isinstance(known_encoding, list) or not known_encoding:
        return jsonify({"error": "known_encoding must be a non-empty array"}), 400

    try:
        rgb = decode_base64_image(image_b64)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    try:
        locations = face_recognition.face_locations(rgb, model="hog")
        if not locations:
            return jsonify({"error": "no face found"}), 400

        encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)
        if not encodings:
            return jsonify({"error": "face encoding failed"}), 400

        known = np.asarray(known_encoding, dtype=np.float32).reshape(-1)
        if known.size != 128:
            return jsonify({"error": f"known_encoding must contain 128 values, got {known.size}"}), 400

        live_encoding = np.asarray(encodings[0], dtype=np.float32).reshape(-1)
        if live_encoding.size != known.size:
            return jsonify(
                {
                    "error": (
                        "encoding dimension mismatch: "
                        f"known={known.size}, live={live_encoding.size}"
                    )
                }
            ), 400

        # Euclidean distance between encodings.
        distance = float(np.linalg.norm(known - live_encoding))
        matched = distance <= threshold
        return jsonify({"matched": matched, "distance": distance, "threshold": threshold, "mode": "face_recognition"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/detect-blink", methods=["POST"])
def detect_blink():
    payload = _json()
    frames = payload.get("frames")
    if not isinstance(frames, list) or not frames:
        return jsonify({"error": "frames must be a non-empty array"}), 400

    # Liveness tuning.
    ear_threshold = float(payload.get("ear_threshold", os.getenv("EAR_THRESHOLD", "0.21")))
    consecutive_frames = int(payload.get("consecutive_frames", os.getenv("EAR_CONSECUTIVE_FRAMES", "3")))
    min_blinks = int(payload.get("min_blinks", os.getenv("MIN_BLINKS", "1")))
    max_frames = int(payload.get("max_frames", os.getenv("MAX_FRAMES", "30")))
    cooldown_frames = int(payload.get("cooldown_frames", os.getenv("COOLDOWN_FRAMES", "5")))

    frames = frames[:max_frames]

    try:
        blink_count = 0
        below_count = 0
        cooldown = 0

        # Only evaluate the first detectable face per frame.
        for image_b64 in frames:
            try:
                rgb = decode_base64_image(image_b64)
                ear = _extract_ear(rgb)
            except ValueError:
                # If we can't detect landmarks in a frame, ignore it.
                continue
            except Exception:
                continue

            if cooldown > 0:
                cooldown -= 1
                # Still keep state tracking in case ear remains low/high.
                if ear < ear_threshold:
                    below_count += 1
                continue

            if ear < ear_threshold:
                below_count += 1
            else:
                if below_count >= consecutive_frames:
                    blink_count += 1
                    cooldown = cooldown_frames
                below_count = 0

        blinked = blink_count >= min_blinks
        return jsonify(
            {
                "blinked": blinked,
                "blink_count": blink_count,
                "ear_threshold": ear_threshold,
                "consecutive_frames": consecutive_frames,
                "min_blinks": min_blinks,
                "mode": "face_recognition",
            }
        )
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    debug = os.getenv("FLASK_DEBUG", "0").strip() in {"1", "true", "True"}
    app.run(host="0.0.0.0", port=port, debug=debug)
