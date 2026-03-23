import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";

import { loadEnv } from "./config/env.js";
import { getPool, closePool } from "./db/pool.js";

function resolveRepoRoot(): string {
  // apps/api/src/migrate.ts -> repo root is ../../../
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../..");
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const apiEnvPath = path.join(repoRoot, "apps", "api", ".env");
  loadDotEnv({ path: apiEnvPath });

  const env = loadEnv();
  const pool = getPool(env);

  const sqlPath = path.join(repoRoot, "infra", "sql", "001_initial_schema.sql");
  const sql = readFileSync(sqlPath, "utf8");

  const exists = await pool.query<{ election: string | null }>(
    `SELECT to_regclass('public.election') AS election`
  );
  if (exists.rows[0]?.election) {
    console.log("Schema already exists (election table found). Skipping migration.");
    await closePool();
    return;
  }

  console.log(`Applying schema: ${sqlPath}`);
  await pool.query(sql);
  console.log("Schema applied successfully.");

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

