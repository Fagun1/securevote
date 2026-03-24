import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import type { Env } from "../config/env.js";

function hasSmtpConfig(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
}

async function resolveSmtpHost(env: Env): Promise<{ host: string; tlsServername?: string }> {
  const host = env.SMTP_HOST!;
  if (!env.SMTP_FORCE_IPV4) return { host };

  try {
    const addr = await lookup(host, { family: 4 });
    return { host: addr.address, tlsServername: host };
  } catch {
    return { host };
  }
}

export async function sendCredentialsEmail(params: {
  env: Env;
  to: string;
  name: string;
  password: string;
  role: "admin" | "voter";
}): Promise<void> {
  const { env, to, name, password, role } = params;

  if (!hasSmtpConfig(env)) {
    const msg = `Credentials generated for ${to} (${role}). Password: ${password}`;
    if (env.NODE_ENV === "production") {
      throw Object.assign(new Error("SMTP configuration is required in production"), { statusCode: 500 });
    }
    console.warn(`[DEV_EMAIL_FALLBACK] ${msg}`);
    return;
  }

  const resolved = await resolveSmtpHost(env);

  const transporter = nodemailer.createTransport({
    host: resolved.host,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(resolved.tlsServername ? { tls: { servername: resolved.tlsServername } } : {}),
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: `SecureVote AI ${role} account credentials`,
    text: [
      `Hello ${name},`,
      "",
      `Your SecureVote AI ${role} account has been created.`,
      `Email: ${to}`,
      `Password: ${password}`,
      "",
      "Login instructions:",
      "1) Open the login page.",
      "2) Enter email and password.",
      "3) Complete face + blink verification.",
      "",
      "Please change your password after first login.",
    ].join("\n"),
  });
}
