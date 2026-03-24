import { z } from "zod";

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

const voteKeySchema = z
  .string()
  .min(1, "VOTE_ENCRYPTION_KEY is required")
  .refine(
    (v) => {
      const hex = /^[0-9a-fA-F]{64}$/.test(v);
      try {
        const b64 = Buffer.from(v, "base64");
        const b64ok = b64.length === 32;
        return hex || b64ok;
      } catch {
        return hex;
      }
    },
    { message: "VOTE_ENCRYPTION_KEY must be 64 hex chars (32 bytes) or base64 decoding to 32 bytes" }
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (s) => /^postgres(ql)?:\/\//i.test(s),
      "DATABASE_URL must be a postgresql:// or postgres:// connection string"
    ),
  JWT_SECRET: z.string().min(32, "JWT_SECRET should be at least 32 characters for HS256"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  VOTE_ENCRYPTION_KEY: voteKeySchema,
  AI_SERVICE_URL: z.string().url().optional().default("http://127.0.0.1:5001"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  SMTP_HOST: emptyToUndefined(z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  SMTP_FORCE_IPV4: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((v) => v === "true"),
  SMTP_USER: emptyToUndefined(z.string().optional()),
  SMTP_PASS: emptyToUndefined(z.string().optional()),
  EMAIL_FROM: emptyToUndefined(z.string().email().optional()),
  BOOTSTRAP_SUPER_ADMIN_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated process.env — call once at startup */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  cached = parsed.data;
  return parsed.data;
}
