import { config as loadDotEnv } from "dotenv";
import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { loadEnv } from "../config/env.js";

loadDotEnv();

function missingSmtpFields(env: ReturnType<typeof loadEnv>): string[] {
  const missing: string[] = [];
  if (!env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!env.SMTP_PORT) missing.push("SMTP_PORT");
  if (!env.SMTP_USER) missing.push("SMTP_USER");
  if (!env.SMTP_PASS) missing.push("SMTP_PASS");
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
  return missing;
}

async function run(): Promise<void> {
  const env = loadEnv();
  const missing = missingSmtpFields(env);
  if (missing.length > 0) {
    throw new Error(`Missing SMTP config in apps/api/.env: ${missing.join(", ")}`);
  }

  const to = process.argv[2] || env.SMTP_USER!;
  const hostTargets: Array<{ host: string; tlsServername?: string; port: number; secure: boolean }> = [];
  if (env.SMTP_FORCE_IPV4) {
    try {
      const addrs = await lookup(env.SMTP_HOST!, { family: 4, all: true });
      for (const addr of addrs) {
        hostTargets.push({
          host: addr.address,
          tlsServername: env.SMTP_HOST!,
          port: env.SMTP_PORT!,
          secure: env.SMTP_SECURE,
        });
      }
    } catch {
      // fall back to hostname target below
    }
  }

  hostTargets.push({ host: env.SMTP_HOST!, port: env.SMTP_PORT!, secure: env.SMTP_SECURE });
  if (env.SMTP_HOST!.includes("gmail.com") && env.SMTP_PORT === 587 && env.SMTP_SECURE === false) {
    hostTargets.push(...hostTargets.map((t) => ({ ...t, port: 465, secure: true })));
  }

  let sent = false;
  let lastErr: unknown = null;
  for (const t of hostTargets) {
    try {
      const transporter = nodemailer.createTransport({
        host: t.host,
        port: t.port,
        secure: t.secure,
        ...(t.tlsServername ? { tls: { servername: t.tlsServername } } : {}),
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS!.replace(/\s+/g, ""),
        },
      });

      await transporter.verify();
      const info = await transporter.sendMail({
        from: env.EMAIL_FROM!,
        to,
        subject: "SecureVote SMTP test",
        text: [
          "SMTP test email from SecureVote API.",
          `Sent at: ${new Date().toISOString()}`,
          `Server: ${env.SMTP_HOST}:${t.port} (secure=${String(t.secure)})`,
        ].join("\n"),
      });

      console.log(`SMTP OK. Message sent to ${to}. messageId=${info.messageId}`);
      sent = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!sent) throw lastErr instanceof Error ? lastErr : new Error("SMTP test failed");
}

void run().catch((err) => {
  console.error(`SMTP test failed: ${(err as Error).message}`);
  process.exit(1);
});
