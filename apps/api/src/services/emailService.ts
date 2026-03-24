import nodemailer from "nodemailer";
import type { Env } from "../config/env.js";

function hasSmtpConfig(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
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

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
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
