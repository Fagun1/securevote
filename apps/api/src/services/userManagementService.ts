import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { aiEncodeFace } from "./aiClient.js";
import { sendCredentialsEmail } from "./emailService.js";
import { logAction } from "./authService.js";

export async function createAdminAccount(params: {
  env: Env;
  pool: Pool;
  actor: { userId: string; role: "voter" | "admin" | "super_admin"; ip: string };
  name: string;
  email: string;
  faceImageBase64: string;
}): Promise<{ id: string; email: string; role: "admin"; generatedPassword: string }> {
  const { env, pool, actor, name, email, faceImageBase64 } = params;
  if (actor.role !== "super_admin") {
    throw Object.assign(new Error("Only super_admin can create admins"), { statusCode: 403 });
  }
  const normalizedEmail = email.toLowerCase();
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
  if (existing.rowCount) throw Object.assign(new Error("Email already registered"), { statusCode: 409 });

  const generatedPassword = generatePassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  const encoded = await aiEncodeFace(env, faceImageBase64);
  const created = await pool.query<{ id: string; email: string }>(
    `INSERT INTO users (name, email, password, role, has_voted, face_encoding, is_verified)
     VALUES ($1, $2, $3, 'admin', FALSE, $4::jsonb, TRUE)
     RETURNING id, email`,
    [name, normalizedEmail, passwordHash, JSON.stringify(encoded.encoding)]
  );
  const user = created.rows[0];

  await sendCredentialsEmail({
    env,
    to: user.email,
    name,
    password: generatedPassword,
    role: "admin",
  });
  await logAction({
    pool,
    userId: actor.userId,
    action: "super_admin_created_admin",
    ip: actor.ip,
    metadata: { targetUserId: user.id, targetEmail: user.email },
  });

  return { id: user.id, email: user.email, role: "admin", generatedPassword };
}

export async function createVoterAccount(params: {
  env: Env;
  pool: Pool;
  actor: { userId: string; role: "voter" | "admin" | "super_admin"; ip: string };
  name: string;
  email: string;
  faceImageBase64?: string;
}): Promise<{ id: string; email: string; role: "voter"; generatedPassword: string }> {
  const { env, pool, actor, name, email, faceImageBase64 } = params;
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw Object.assign(new Error("Only admin or super_admin can create voters"), { statusCode: 403 });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
  if (existing.rowCount) throw Object.assign(new Error("Email already registered"), { statusCode: 409 });

  const generatedPassword = generatePassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  let faceEncoding: number[] | null = null;
  if (faceImageBase64 && faceImageBase64.trim().length > 0) {
    const encoded = await aiEncodeFace(env, faceImageBase64);
    faceEncoding = encoded.encoding;
  }

  const created = await pool.query<{ id: string; email: string }>(
    `INSERT INTO users (name, email, password, role, has_voted, face_encoding, is_verified)
     VALUES ($1, $2, $3, 'voter', FALSE, $4::jsonb, $5)
     RETURNING id, email`,
    [name, normalizedEmail, passwordHash, faceEncoding ? JSON.stringify(faceEncoding) : null, faceEncoding ? true : false]
  );
  const user = created.rows[0];

  await sendCredentialsEmail({
    env,
    to: user.email,
    name,
    password: generatedPassword,
    role: "voter",
  });
  await logAction({
    pool,
    userId: actor.userId,
    action: "admin_created_voter",
    ip: actor.ip,
    metadata: { targetUserId: user.id, targetEmail: user.email, hasFaceEnrollment: Boolean(faceEncoding) },
  });

  return { id: user.id, email: user.email, role: "voter", generatedPassword };
}

export async function setVoterFaceEncoding(params: {
  env: Env;
  pool: Pool;
  actor: { userId: string; role: "voter" | "admin" | "super_admin"; ip: string };
  voterId: string;
  faceImageBase64: string;
}): Promise<{ ok: true }> {
  const { env, pool, actor, voterId, faceImageBase64 } = params;
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw Object.assign(new Error("Only admin or super_admin can enroll voter face"), { statusCode: 403 });
  }
  const exists = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [voterId]);
  if (!exists.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
  const row = exists.rows[0] as { role: "voter" | "admin" | "super_admin" };
  if (row.role !== "voter") throw Object.assign(new Error("Target user is not a voter"), { statusCode: 400 });

  const { encoding } = await aiEncodeFace(env, faceImageBase64);
  await pool.query(`UPDATE users SET face_encoding = $2::jsonb, is_verified = TRUE WHERE id = $1`, [
    voterId,
    JSON.stringify(encoding),
  ]);
  await logAction({
    pool,
    userId: actor.userId,
    action: "admin_enrolled_voter_face",
    ip: actor.ip,
    metadata: { targetUserId: voterId },
  });
  return { ok: true };
}

function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}
