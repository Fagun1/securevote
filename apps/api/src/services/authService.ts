import bcrypt from "bcrypt";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { aiDetectBlink, aiEncodeFace, aiMatchFace } from "./aiClient.js";
import { createJwt } from "../utils/jwt.js";

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  faceImageBase64: string;
};

export type LoginInput = {
  email: string;
  password: string;
  faceImageBase64?: string;
  framesBase64?: string[];
};

function parseDlibEncoding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length !== 128) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return value as number[];
}

function mapBiometricLoginError(e: unknown): Error {
  const status = (e as { statusCode?: number }).statusCode;
  const message = (e as Error).message || "Face verification failed";

  if (status === 401) return e as Error;

  // AI can return 400 for recoverable user-input issues (no face, bad frame).
  if (status === 400) {
    return Object.assign(new Error(`Biometric verification failed: ${message}`), { statusCode: 401 });
  }

  if (status === 504) {
    return Object.assign(new Error("Biometric verification timed out. Please try again."), { statusCode: 504 });
  }

  return Object.assign(new Error("Biometric verification service unavailable. Please try again."), { statusCode: 503 });
}

export async function logAction(params: {
  pool: Pool;
  userId: string | null;
  action: string;
  ip: string;
  metadata?: unknown;
}): Promise<void> {
  const { pool, userId, action, ip, metadata } = params;
  await pool.query(
    `INSERT INTO logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, action, ip || null, JSON.stringify(metadata ?? null)]
  );
}

export async function registerUser(env: Env, pool: Pool, input: RegisterInput): Promise<void> {
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [input.email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw Object.assign(new Error("Email already registered"), { statusCode: 409 });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const { encoding } = await aiEncodeFace(env, input.faceImageBase64);
  const role: "voter" = "voter";

  await pool.query(
    `INSERT INTO users (name, email, password, role, has_voted, face_encoding)
     VALUES ($1, $2, $3, $4, false, $5::jsonb)`,
    [input.name, input.email, passwordHash, role, JSON.stringify(encoding)]
  );
}

export async function loginUser(
  env: Env,
  pool: Pool,
  req: { ip: string },
  input: LoginInput
): Promise<{ token: string; role: "voter" | "admin" | "super_admin" }> {
  const { ip } = req;

  const u = await pool.query(
    `SELECT id, password, role, face_encoding FROM users WHERE email = $1`,
    [input.email]
  );
  if (!u.rowCount) {
    await logAction({ pool, userId: null, action: "login_failed_unknown_user", ip, metadata: { email: input.email } });
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
  }

  const user = u.rows[0] as { id: string; password: string; role: string; face_encoding: unknown };
  const okPass = await bcrypt.compare(input.password, user.password);
  if (!okPass) {
    await logAction({ pool, userId: user.id, action: "login_failed_password", ip, metadata: { email: input.email } });
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
  }

  const rawFaceEncodingPresent = Array.isArray(user.face_encoding) && user.face_encoding.length > 0;
  const faceEncoding = parseDlibEncoding(user.face_encoding);
  const hasFaceEncoding = Array.isArray(faceEncoding) && faceEncoding.length === 128;
  const hasLegacyFaceEncoding = rawFaceEncodingPresent && !hasFaceEncoding;
  const hasFrames = Array.isArray(input.framesBase64) && input.framesBase64.length >= 3;
  const hasSingleImage = typeof input.faceImageBase64 === "string" && input.faceImageBase64.length > 10;

  if (!hasFaceEncoding && !hasLegacyFaceEncoding) {
    // No face enrollment yet - allow password-only login for initial access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = createJwt(env, { sub: user.id, role: user.role as any });
    await logAction({ pool, userId: user.id, action: "login_success_no_face_enrolled", ip, metadata: { role: user.role } });
    return { token, role: user.role as any };
  }

  if (hasFrames) {
    // Blink liveness detection
    try {
      const detect = await aiDetectBlink(env, input.framesBase64!, {
        minBlinks: 1,
        consecutiveFrames: 1,
        eyeOpenRatio: 0.008,
      });
      if (!detect.blinked) {
        await logAction({ pool, userId: user.id, action: "login_failed_liveness", ip, metadata: detect });
        throw Object.assign(new Error("Liveness check failed. Please blink naturally while looking at the camera."), { statusCode: 401 });
      }
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 401) throw e;
      // AI service down or error - log but allow face match check
      await logAction({ pool, userId: user.id, action: "login_liveness_skipped_error", ip, metadata: { error: (e as Error).message } });
    }

    // Face match using last frame
    const frameForMatch = input.framesBase64![input.framesBase64!.length - 1];
    try {
      if (hasLegacyFaceEncoding) {
        // Re-enroll from live frame after password + liveness checks.
        const { encoding } = await aiEncodeFace(env, frameForMatch);
        await pool.query(`UPDATE users SET face_encoding = $2::jsonb, is_verified = TRUE WHERE id = $1`, [
          user.id,
          JSON.stringify(encoding),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const token = createJwt(env, { sub: user.id, role: user.role as any });
        await logAction({
          pool,
          userId: user.id,
          action: "login_reenroll_face_success",
          ip,
          metadata: { previousEncodingLength: Array.isArray(user.face_encoding) ? user.face_encoding.length : null },
        });
        return { token, role: user.role as any };
      }
      const match = await aiMatchFace(env, faceEncoding!, frameForMatch, 0.35);
      if (!match.matched) {
        await logAction({ pool, userId: user.id, action: "login_failed_face_mismatch", ip, metadata: match });
        throw Object.assign(new Error("Face mismatch. Ensure good lighting and face the camera directly."), { statusCode: 401 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = createJwt(env, { sub: user.id, role: user.role as any });
      await logAction({ pool, userId: user.id, action: "login_success", ip, metadata: match });
      return { token, role: user.role as any };
    } catch (e) {
      await logAction({ pool, userId: user.id, action: "login_face_match_error", ip, metadata: { error: (e as Error).message } });
      throw mapBiometricLoginError(e);
    }
  }

  if (hasSingleImage) {
    // Single image face match (simpler flow)
    try {
      if (hasLegacyFaceEncoding) {
        const { encoding } = await aiEncodeFace(env, input.faceImageBase64!);
        await pool.query(`UPDATE users SET face_encoding = $2::jsonb, is_verified = TRUE WHERE id = $1`, [
          user.id,
          JSON.stringify(encoding),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const token = createJwt(env, { sub: user.id, role: user.role as any });
        await logAction({
          pool,
          userId: user.id,
          action: "login_reenroll_face_success",
          ip,
          metadata: { previousEncodingLength: Array.isArray(user.face_encoding) ? user.face_encoding.length : null },
        });
        return { token, role: user.role as any };
      }
      const match = await aiMatchFace(env, faceEncoding!, input.faceImageBase64!, 0.35);
      if (!match.matched) {
        await logAction({ pool, userId: user.id, action: "login_failed_face_mismatch", ip, metadata: match });
        throw Object.assign(new Error("Face mismatch"), { statusCode: 401 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = createJwt(env, { sub: user.id, role: user.role as any });
      await logAction({ pool, userId: user.id, action: "login_success", ip, metadata: match });
      return { token, role: user.role as any };
    } catch (e) {
      throw mapBiometricLoginError(e);
    }
  }

  if (hasLegacyFaceEncoding) {
    await logAction({
      pool,
      userId: user.id,
      action: "login_face_profile_invalid_format",
      ip,
      metadata: { encodingLength: Array.isArray(user.face_encoding) ? user.face_encoding.length : null },
    });
    throw Object.assign(
      new Error("Stored face profile is incompatible. Continue to camera to re-enroll."),
      { statusCode: 403, code: "FACE_REENROLL_REQUIRED" }
    );
  }

  // Face is enrolled but no biometric data was submitted — tell client to proceed to step 2
  throw Object.assign(
    new Error("Face verification required. Please proceed to biometric step."),
    { statusCode: 403, code: "FACE_REQUIRED" }
  );
}

export async function promoteSelfToSuperAdmin(env: Env, pool: Pool, userId: string, ip: string): Promise<{
  token: string;
  role: "super_admin";
}> {
  if (env.NODE_ENV === "production") {
    throw Object.assign(new Error("Promotion disabled in production"), { statusCode: 403 });
  }

  const existingAdmins = await pool.query(
    `SELECT COUNT(*)::int AS c FROM users WHERE role IN ('admin', 'super_admin')`
  );
  const c = (existingAdmins.rows[0] as { c: number }).c;
  if (c > 0) throw Object.assign(new Error("Admin already exists"), { statusCode: 409 });

  await pool.query(
    `UPDATE users SET role = 'super_admin' WHERE id = $1`,
    [userId]
  );

  await logAction({
    pool,
    userId,
    action: "super_admin_promoted_self",
    ip,
    metadata: { promotedTo: "super_admin" },
  });

  const token = createJwt(env, { sub: userId, role: "super_admin" });
  return { token, role: "super_admin" };
}

export async function promoteUserToAdminByEmail(
  pool: Pool,
  actor: { userId: string; role: "voter" | "admin" | "super_admin"; ip: string },
  targetEmail: string
): Promise<{ id: string; email: string; role: "admin" }> {
  if (actor.role !== "super_admin") {
    throw Object.assign(new Error("Only super_admin can promote users"), { statusCode: 403 });
  }

  const normalizedEmail = targetEmail.toLowerCase();
  const userRes = await pool.query(`SELECT id, email, role FROM users WHERE email = $1`, [normalizedEmail]);
  if (!userRes.rowCount) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }

  const user = userRes.rows[0] as { id: string; email: string; role: "voter" | "admin" | "super_admin" };
  if (user.role === "super_admin") {
    throw Object.assign(new Error("Cannot change super_admin role"), { statusCode: 409 });
  }
  if (user.role === "admin") {
    return { id: user.id, email: user.email, role: "admin" };
  }

  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
  await logAction({
    pool,
    userId: actor.userId,
    action: "super_admin_promoted_user_to_admin",
    ip: actor.ip,
    metadata: { targetUserId: user.id, targetEmail: user.email, previousRole: user.role, nextRole: "admin" },
  });

  return { id: user.id, email: user.email, role: "admin" };
}
