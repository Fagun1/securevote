import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
  loginUser,
  promoteSelfToSuperAdmin,
  registerUser,
  type LoginInput,
  type RegisterInput,
  logAction,
} from "../services/authService.js";
import { getClientIp } from "../utils/ip.js";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  faceImageBase64: z.string().min(10),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  framesBase64: z.array(z.string().min(10)).min(3).max(30),
});

export function createAuthController(env: Env, pool: Pool) {
  async function register(req: Request, res: Response) {
    const ip = getClientIp(req);
    const body = registerSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const input: RegisterInput = {
      name: body.data.name,
      email: body.data.email.toLowerCase(),
      password: body.data.password,
      faceImageBase64: body.data.faceImageBase64,
    };

    // Controller passes IP and writes audit logs consistently.
    try {
      await registerUser(env, pool, input);
      await logAction({ pool, userId: null, action: "register_success", ip, metadata: { email: input.email } });
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode ?? 500;
      throw Object.assign(new Error((e as Error).message || "Register failed"), { statusCode });
    }

    res.json({ ok: true });
  }

  async function login(req: Request, res: Response) {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const ip = getClientIp(req as any);
    const input: LoginInput = {
      email: body.data.email.toLowerCase(),
      password: body.data.password,
      framesBase64: body.data.framesBase64,
    };

    try {
      const { token, role } = await loginUser(env, pool, { ip }, input);
      res.json({ token, role });
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode ?? 500;
      throw Object.assign(new Error((e as Error).message || "Login failed"), { statusCode });
    }
  }

  async function me(req: Request, res: Response) {
    const auth = (req as any).auth as { sub?: unknown };
    const userId = auth?.sub;
    if (typeof userId !== "string") throw new HttpError(401, "Not authenticated");

    const u = await pool.query(`SELECT id, name, email, role, has_voted FROM users WHERE id = $1`, [userId]);
    if (!u.rowCount) throw new HttpError(404, "User not found");
    const user = u.rows[0] as { id: string; name: string; email: string; role: string; has_voted: boolean };
    res.json({ user });
  }

  async function superAdminBootstrap(req: Request, res: Response) {
    // Bootstrapping is handled by a static token; no JWT required for first admin.
    if (!env.BOOTSTRAP_SUPER_ADMIN_TOKEN) {
      throw new HttpError(403, "Bootstrap disabled");
    }
    const headerToken =
      typeof (req as any).headers?.["x-bootstrap-token"] === "string"
        ? ((req as any).headers["x-bootstrap-token"] as string)
        : undefined;
    const body = z
      .object({
        token: z.string().min(1).optional(),
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        faceImageBase64: z.string().min(10),
      })
      .safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid request body");

    const token = body.data.token ?? headerToken;
    if (token !== env.BOOTSTRAP_SUPER_ADMIN_TOKEN) throw new HttpError(403, "Invalid bootstrap token");

    const count = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
    const c = (count.rows[0] as { c: number }).c;
    if (c > 0) throw new HttpError(409, "Users already exist");

    const input: RegisterInput = {
      name: body.data.name,
      email: body.data.email.toLowerCase(),
      password: body.data.password,
      faceImageBase64: body.data.faceImageBase64,
    };

    // Reuse registerUser but force role super_admin by custom insert.
    // We implement it directly so bootstrap is deterministic.
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [input.email]);
    if (existing.rowCount) throw new HttpError(409, "Email already registered");

    const passwordHash = await bcrypt.hash(input.password, 12);
    const { aiEncodeFace } = await import("../services/aiClient.js");
    const { encoding } = await aiEncodeFace(env, input.faceImageBase64);
    await pool.query(
      `INSERT INTO users (name, email, password, role, has_voted, face_encoding)
       VALUES ($1, $2, $3, 'super_admin', false, $4::jsonb)`,
      [input.name, input.email, passwordHash, JSON.stringify(encoding)]
    );

    res.json({ ok: true });
  }

  async function promoteSelf(req: Request, res: Response) {
    const auth = (req as any).auth as { sub?: unknown };
    const userId = auth?.sub;
    if (typeof userId !== "string") throw new HttpError(401, "Not authenticated");

    const ip = getClientIp(req);
    const data = await promoteSelfToSuperAdmin(env, pool, userId, ip);
    res.json(data);
  }

  return { register, login, me, superAdminBootstrap, promoteSelf };
}

