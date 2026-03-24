import type { Env } from "../config/env.js";

function ensureArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string") as string[];
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // AI service returns JSON errors like: { "error": "..." }.
        const parsed = safeJsonParse<{ error?: string }>(text);
        const msg = parsed?.error || text || `AI request failed with status ${res.status}`;
        throw Object.assign(new Error(msg), { statusCode: res.status });
      }
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode) throw err;
      if ((err as Error).name === "AbortError") {
        throw Object.assign(new Error("AI service timeout"), { statusCode: 504 });
      }
      throw Object.assign(new Error("AI service unavailable"), { statusCode: 503 });
    }
  } finally {
    clearTimeout(t);
  }
}

export type EncodeFaceResult = { encoding: number[] };
export type MatchFaceResult = { matched: boolean; distance: number; threshold: number };
export type DetectBlinkResult = {
  blinked: boolean;
  blink_count: number;
  ear_threshold: number;
  consecutive_frames: number;
  min_blinks: number;
};

export async function aiEncodeFace(env: Env, imageBase64: string): Promise<EncodeFaceResult> {
  if (!env.AI_SERVICE_URL) throw new Error("AI_SERVICE_URL missing");
  return postJson<EncodeFaceResult>(`${env.AI_SERVICE_URL}/encode-face`, { image: imageBase64 }, 20_000);
}

export async function aiMatchFace(
  env: Env,
  knownEncoding: number[],
  imageBase64: string,
  threshold?: number
): Promise<MatchFaceResult> {
  if (!env.AI_SERVICE_URL) throw new Error("AI_SERVICE_URL missing");
  return postJson<MatchFaceResult>(
    `${env.AI_SERVICE_URL}/match-face`,
    { known_encoding: knownEncoding, image: imageBase64, ...(threshold ? { threshold } : {}) },
    20_000
  );
}

export async function aiDetectBlink(
  env: Env,
  framesBase64: string[],
  params?: { earThreshold?: number; consecutiveFrames?: number; minBlinks?: number; eyeOpenRatio?: number }
): Promise<DetectBlinkResult> {
  if (!env.AI_SERVICE_URL) throw new Error("AI_SERVICE_URL missing");
  const frames = ensureArrayOfStrings(framesBase64).slice(0, 30);
  if (frames.length === 0) throw new Error("frames required for blink detection");

  return postJson<DetectBlinkResult>(
    `${env.AI_SERVICE_URL}/detect-blink`,
    {
      frames,
      ...(params?.earThreshold !== undefined ? { ear_threshold: params.earThreshold } : {}),
      ...(params?.consecutiveFrames !== undefined ? { consecutive_frames: params.consecutiveFrames } : {}),
      ...(params?.minBlinks !== undefined ? { min_blinks: params.minBlinks } : {}),
      ...(params?.eyeOpenRatio !== undefined ? { eye_open_ratio: params.eyeOpenRatio } : {}),
    },
    25_000
  );
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

