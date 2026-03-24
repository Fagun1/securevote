import { config as loadDotEnv } from "dotenv";
import nodemailer from "nodemailer";
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
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
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
      `Server: ${env.SMTP_HOST}:${env.SMTP_PORT} (secure=${String(env.SMTP_SECURE)})`,
    ].join("\n"),
  });

  console.log(`SMTP OK. Message sent to ${to}. messageId=${info.messageId}`);
}

void run().catch((err) => {
  console.error(`SMTP test failed: ${(err as Error).message}`);
  process.exit(1);
});

