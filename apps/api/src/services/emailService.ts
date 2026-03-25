import nodemailer from "nodemailer";
import { resolve4 } from "node:dns/promises";
import type { Env } from "../config/env.js";

function hasSmtpConfig(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
}

type SmtpTarget = {
  host: string;
  port: number;
  secure: boolean;
  tlsServername?: string;
};

function isRetryableSmtpConnectionError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  return ["ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ESOCKET", "ECONNRESET"].includes(code);
}

async function resolveSmtpTargets(env: Env): Promise<SmtpTarget[]> {
  const baseHost = env.SMTP_HOST!;
  const targets: SmtpTarget[] = [];

  if (env.SMTP_FORCE_IPV4) {
    try {
      const addrs = await resolve4(baseHost);
      for (const address of addrs) {
        targets.push({
          host: address,
          port: env.SMTP_PORT!,
          secure: env.SMTP_SECURE,
          tlsServername: baseHost,
        });
      }
    } catch {
      // No IPv4 DNS answer available; keep targets empty and fail clearly below.
    }
  }

  // Only use hostname fallback when IPv4 forcing is disabled.
  if (!env.SMTP_FORCE_IPV4) {
    targets.push({
      host: baseHost,
      port: env.SMTP_PORT!,
      secure: env.SMTP_SECURE,
    });
  }

  // Gmail fallback: if STARTTLS on 587 times out, retry SMTPS 465.
  if (baseHost.includes("gmail.com") && env.SMTP_PORT === 587 && env.SMTP_SECURE === false) {
    const gmail465: SmtpTarget[] = targets.map((t) => ({ ...t, port: 465, secure: true }));
    targets.push(...gmail465);
  }

  // De-duplicate targets.
  const seen = new Set<string>();
  const deduped: SmtpTarget[] = [];
  for (const t of targets) {
    const key = `${t.host}|${t.port}|${String(t.secure)}|${t.tlsServername || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  if (targets.length === 0 && env.SMTP_FORCE_IPV4) {
    throw Object.assign(
      new Error("No IPv4 SMTP endpoints resolved. Keep SMTP_FORCE_IPV4=true and verify SMTP host/provider."),
      { statusCode: 503 }
    );
  }

  return deduped;
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

  const targets = await resolveSmtpTargets(env);
  const smtpPass = env.SMTP_PASS!.replace(/\s+/g, "");

  const message = {
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
  };

  let lastErr: unknown = null;
  for (const target of targets) {
    try {
      const transporter = nodemailer.createTransport({
        host: target.host,
        port: target.port,
        secure: target.secure,
        connectionTimeout: 12_000,
        greetingTimeout: 12_000,
        socketTimeout: 20_000,
        ...(target.tlsServername ? { tls: { servername: target.tlsServername } } : {}),
        auth: {
          user: env.SMTP_USER,
          pass: smtpPass,
        },
      });
      await transporter.sendMail(message);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableSmtpConnectionError(err)) {
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("SMTP delivery failed");
}
