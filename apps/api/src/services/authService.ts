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
  framesBase64: string[];
};

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
  const ip = "0.0.0.0";
  // IP is logged by controller; service logs only success/failure actions with the same contract.
  // Keep service pure to the extent possible.
  // (Controller passes correct IP by calling logAction explicitly.)

  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [input.email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw Object.assign(new Error("Email already registered"), { statusCode: 409 });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const { encoding } = await aiEncodeFace(env, input.faceImageBase64);

  // Dev convenience:
  // If this is the first ever user and no explicit bootstrap token is configured,
  // promote the first registered account to super_admin (local single-machine setup).
  const userCountRes = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  const userCount = (userCountRes.rows[0] as { c: number }).c;
  const shouldBootstrapFirstUser =
    env.NODE_ENV !== "production" && !env.BOOTSTRAP_SUPER_ADMIN_TOKEN && userCount === 0;
  const role: "voter" | "super_admin" = shouldBootstrapFirstUser ? "super_admin" : "voter";

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

  // OpenCV fallback blink detection is cascade-based and can miss eyes in some frames.
  // Using a slightly smaller consecutive window makes liveness robust while still requiring at least one blink.
  const detect = await aiDetectBlink(env, input.framesBase64, { minBlinks: 1, consecutiveFrames: 2 });
  if (!detect.blinked) {
    await logAction({ pool, userId: user.id, action: "login_failed_liveness", ip, metadata: detect });
    throw Object.assign(new Error("Liveness check failed"), { statusCode: 401 });
  }

  const framesLast = input.framesBase64[input.framesBase64.length - 1];
  const faceEncoding = user.face_encoding;
  if (!Array.isArray(faceEncoding)) {
    await logAction({
      pool,
      userId: user.id,
      action: "login_failed_face_encoding_invalid",
      ip,
      metadata: { storedType: typeof faceEncoding },
    });
    throw Object.assign(new Error("Face encoding missing"), { statusCode: 500 });
  }

  const match = await aiMatchFace(
    env,
    faceEncoding as number[],
    framesLast,
    undefined
  );
  if (!match.matched) {
    await logAction({ pool, userId: user.id, action: "login_failed_face_mismatch", ip, metadata: match });
    throw Object.assign(new Error("Face mismatch"), { statusCode: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = createJwt(env, { sub: user.id, role: user.role as any });

  await logAction({ pool, userId: user.id, action: "login_success", ip, metadata: match });
  return { token, role: user.role as any };
}

export async function promoteSelfToSuperAdmin(env: Env, pool: Pool, userId: string, ip: string): Promise<{
  token: string;
  role: "super_admin";
}> {
  if (env.NODE_ENV === "production") {
    throw Object.assign(new Error("Promotion disabled in production"), { statusCode: 403 });
  }

  // Only allow if there is no admin/super_admin already.
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

