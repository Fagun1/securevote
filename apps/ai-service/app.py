"""
SecureVote AI — Flask service for face encoding, matching, and blink (liveness) detection.

Endpoints:
  - POST /encode-face: returns a single face encoding for the provided image
  - POST /match-face: compares a known encoding to a live image
  - POST /detect-blink: verifies liveness by detecting blinks across a short frame sequence
"""

from __future__ import annotations

import base64
import os
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

# Dependencies:
# - OpenCV + numpy are required for the OpenCV-only fallback.
# - face_recognition (and therefore dlib) is used when available for stronger biometric matching.
try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    _CV2_AVAILABLE = True
except Exception:  # pragma: no cover
    cv2 = None  # type: ignore
    np = None  # type: ignore
    _CV2_AVAILABLE = False

try:
    import face_recognition  # type: ignore

    _FACE_RECOGNITION_AVAILABLE = True
except Exception:  # pragma: no cover
    face_recognition = None  # type: ignore
    _FACE_RECOGNITION_AVAILABLE = False

_BIOMETRIC_MODE = (
    "face_recognition"
    if _CV2_AVAILABLE and _FACE_RECOGNITION_AVAILABLE
    else ("opencv_fallback" if _CV2_AVAILABLE else "unavailable")
)


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

    if not _CV2_AVAILABLE:
        raise RuntimeError("OpenCV dependencies are not available")

    try:
        raw = base64.b64decode(image_b64, validate=True)
    except Exception as e:
        raise ValueError("image must be valid base64") from e

    nparr = np.frombuffer(raw, np.uint8)  # type: ignore[union-attr]
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)  # type: ignore[union-attr]
    if img_bgr is None:
        raise ValueError("image could not be decoded")

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    return img_rgb


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


_face_cascade = None
_eye_cascade = None


def _get_cascades() -> tuple[Any | None, Any | None]:
    """
    Lazily loads Haar cascades from OpenCV's built-in data folder.
    """
    global _face_cascade, _eye_cascade
    if _face_cascade is None and _CV2_AVAILABLE:
        _face_cascade = cv2.CascadeClassifier(  # type: ignore[call-arg]
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"  # type: ignore[attr-defined]
        )
    if _eye_cascade is None and _CV2_AVAILABLE:
        _eye_cascade = cv2.CascadeClassifier(  # type: ignore[call-arg]
            cv2.data.haarcascades + "haarcascade_eye.xml"  # type: ignore[attr-defined]
        )
    return _face_cascade, _eye_cascade


def _fallback_encode_face(rgb_image: np.ndarray) -> list[float]:
    """
    OpenCV-only face encoding:
    - Detect face via Haar cascade
    - Crop face, convert to grayscale, resize to a fixed size
    - Return a normalized flattened vector
    """
    face_cascade, _ = _get_cascades()
    if face_cascade is None:
        raise RuntimeError("Face cascade not available")

    gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)  # type: ignore[arg-type]
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
    if faces is None or len(faces) == 0:
        raise ValueError("no face found")

    # Choose largest face.
    x, y, w, h = max(faces, key=lambda r: int(r[2] * r[3]))
    face = gray[y : y + h, x : x + w]
    face = cv2.resize(face, (64, 64))  # type: ignore[arg-type]

    face_f = face.astype(np.float32)
    # Normalize to reduce brightness variance.
    face_f = (face_f - face_f.mean()) / (face_f.std() + 1e-6)
    return face_f.flatten().tolist()


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b) + 1e-12)
    if denom == 0.0:
        return 0.0
    return float(np.dot(a, b) / denom)


def _fallback_match_face(known_encoding: list[float], rgb_image: np.ndarray, threshold: float) -> dict[str, Any]:
    live_encoding = _fallback_encode_face(rgb_image)

    known = np.asarray(known_encoding, dtype=np.float32)
    live = np.asarray(live_encoding, dtype=np.float32)
    if known.shape != live.shape:
        # Encoding shapes may differ if crop pipeline differs; fail closed.
        return {"matched": False, "score": 0.0, "distance": 1.0, "threshold": threshold}

    score = _cosine_similarity(known, live)
    matched = score >= threshold
    # Provide a "distance-like" number for API compatibility:
    # - face_recognition mode uses Euclidean distance (lower is better)
    # - fallback uses cosine similarity (higher is better)
    # To avoid confusing downstream code that expects "distance", we map it as (1 - similarity).
    distance = 1.0 - score
    return {"matched": matched, "score": score, "distance": distance, "threshold": threshold}


def _fallback_detect_blink(frames_b64: list[str], params: dict[str, Any]) -> dict[str, Any]:
    """
    OpenCV-only blink detection:
    - Detect face and eyes with Haar cascades.
    - Compute eye area ratio (eye bbox area / face bbox area).
    - Treat low eye area ratio (or zero eyes) as "eyes closed".
    - Count blinks when eyes-closed streak lasts `consecutive_frames`.
    """
    _, eye_cascade = _get_cascades()
    if eye_cascade is None:
        raise RuntimeError("Eye cascade not available")

    consecutive_frames = int(params.get("consecutive_frames", 3))
    min_blinks = int(params.get("min_blinks", 1))
    max_frames = int(params.get("max_frames", 30))
    cooldown_frames = int(params.get("cooldown_frames", 5))

    # If Haar detects eyes, but they are mostly closed, the detected boxes tend to shrink.
    # This heuristic makes the closed streak less sensitive than "eyes detected or not".
    eye_open_ratio = float(params.get("eye_open_ratio", 0.012))

    closed_streak = 0
    blink_count = 0
    cooldown = 0

    face_cascade, _ = _get_cascades()

    frames_b64 = frames_b64[:max_frames]
    for image_b64 in frames_b64:
        try:
            rgb = decode_base64_image(image_b64)
        except ValueError:
            continue

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)  # type: ignore[arg-type]
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5) if face_cascade else []
        if faces is None or len(faces) == 0:
            continue

        x, y, w, h = max(faces, key=lambda r: int(r[2] * r[3]))
        roi = gray[y : y + h, x : x + w]

        eyes = eye_cascade.detectMultiScale(roi, scaleFactor=1.1, minNeighbors=5)  # type: ignore[arg-type]
        eye_area_ratio = 0.0
        if eyes is not None and len(eyes) > 0:
            eye_area = 0.0
            for ex, ey, ew, eh in eyes:
                eye_area += float(ew) * float(eh)
            face_area = float(w) * float(h)
            eye_area_ratio = eye_area / (face_area + 1e-6)

        # eyes are "open" if the detected eye area is big enough; otherwise treat as "closed"
        eye_open = eye_area_ratio >= eye_open_ratio

        if cooldown > 0:
            cooldown -= 1
            if eye_open:
                closed_streak = 0
            continue

        if not eye_open:
            closed_streak += 1
        else:
            # If we were already in a closed streak, decide blink only when it reached the target.
            if closed_streak >= consecutive_frames:
                blink_count += 1
                cooldown = cooldown_frames
            closed_streak = 0

    # Handle case where blink ends at end-of-sequence.
    if closed_streak >= consecutive_frames:
        blink_count += 1

    blinked = blink_count >= min_blinks
    return {
        "blinked": blinked,
        "blink_count": blink_count,
        "ear_threshold": float(params.get("ear_threshold", 0.21)),  # kept for API compatibility
        "consecutive_frames": consecutive_frames,
        "min_blinks": min_blinks,
        "eye_open_ratio": eye_open_ratio,
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "service": "ai-service",
            "biometric_deps_available": _FACE_RECOGNITION_AVAILABLE,
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
        if _FACE_RECOGNITION_AVAILABLE:
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

        # Fallback encoding using OpenCV Haar cascades.
        encoding = _fallback_encode_face(rgb)
        return jsonify({"encoding": encoding, "mode": "opencv_fallback"})
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
        if _FACE_RECOGNITION_AVAILABLE:
            locations = face_recognition.face_locations(rgb, model="hog")
            if not locations:
                return jsonify({"error": "no face found"}), 400

            encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)
            if not encodings:
                return jsonify({"error": "face encoding failed"}), 400

            live_encoding = np.asarray(encodings[0], dtype=np.float32)
            known = np.asarray(known_encoding, dtype=np.float32)

            # Euclidean distance between encodings.
            distance = float(np.linalg.norm(known - live_encoding))
            matched = distance <= threshold
            return jsonify({"matched": matched, "distance": distance, "threshold": threshold, "mode": "face_recognition"})

        # Fallback match using cosine similarity between OpenCV encodings.
        result = _fallback_match_face(known_encoding, rgb, threshold)
        return jsonify(
            {
                "matched": result["matched"],
                "score": result["score"],
                "distance": result.get("distance", 1.0 - float(result["score"])),
                "threshold": result["threshold"],
                "mode": "opencv_fallback",
            }
        )
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
        if _FACE_RECOGNITION_AVAILABLE:
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

        # Fallback blink detection using OpenCV cascades.
        result = _fallback_detect_blink(
            frames,
            {
                "ear_threshold": ear_threshold,
                "consecutive_frames": consecutive_frames,
                "min_blinks": min_blinks,
                "max_frames": max_frames,
                "cooldown_frames": cooldown_frames,
                "eye_open_ratio": float(payload.get("eye_open_ratio", os.getenv("EYE_OPEN_RATIO", "0.012"))),
            },
        )
        return jsonify({**result, "mode": "opencv_fallback"})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
