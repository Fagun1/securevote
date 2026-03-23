import pg from "pg";
import type { Env } from "../config/env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Neon requires TLS. Uses DATABASE_URL from env; ssl enabled for non-local hosts.
 */
export function getPool(env: Env): pg.Pool {
  if (pool) return pool;
  const connectionString = env.DATABASE_URL;
  const isLocal =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1");

  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal ? false : { rejectUnauthorized: true },
  });

  pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL pool error", err);
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
