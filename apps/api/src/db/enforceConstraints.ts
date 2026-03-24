import type { Pool } from "pg";

export async function enforceSecurityConstraints(pool: Pool): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin ON users ((TRUE)) WHERE role = 'super_admin'`
  );

  const count = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM users WHERE role = 'super_admin'`
  );
  const superAdminCount = count.rows[0]?.c ?? 0;
  if (superAdminCount !== 1) {
    throw new Error(
      `Invalid super_admin state: expected exactly 1 super_admin, found ${superAdminCount}. Seed manually in DB.`
    );
  }
}
