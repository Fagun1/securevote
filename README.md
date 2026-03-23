# SecureVote AI

Production-oriented monorepo: Next.js frontend, Express API, Neon PostgreSQL, Socket.io, Flask AI service (face recognition), and a custom blockchain layer for vote integrity.

## Prerequisites

- **Node.js** 20+
- **npm** 9+ (workspaces)
- **Neon** account and PostgreSQL connection string
- **Python** 3.10+ (for `apps/ai-service`; optional until you run biometric features)

## Repository layout

| Path | Description |
|------|-------------|
| `apps/api` | Express (TypeScript), database pool, REST + Socket.io |
| `apps/web` | Next.js (TypeScript) + Tailwind |
| `apps/ai-service` | Flask: face encoding, matching, blink detection |
| `packages/shared` | Shared TypeScript types/constants |
| `infra/sql` | Versioned SQL migrations for Neon |

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Neon and run the initial schema

1. Create a project in [Neon](https://neon.tech) and copy the connection string (include `sslmode=require`).
2. Copy environment files:

   ```bash
   copy env.example apps\api\.env
   ```

   Edit `apps\api\.env` and set `DATABASE_URL`, `JWT_SECRET`, and `VOTE_ENCRYPTION_KEY`.

3. Apply the initial migration (see [Database migrations](#database-migrations)).

### 3. Start the API

```bash
npm run dev:api
```

Health check: `GET http://localhost:4000/health` — returns `{ "ok": true, "database": "up" }` when Neon is reachable.

### 4. Start the web app (when configured)

```bash
npm run dev:web
```

### Recommended run order

1. Neon database available and schema applied  
2. Flask AI service (`apps/ai-service`) when using biometric auth  
3. API (`npm run dev:api`)  
4. Web (`npm run dev:web`)

## Environment variables

See [`env.example`](env.example) (copy to `apps/api/.env`). The API requires at minimum:

- `DATABASE_URL` — Neon PostgreSQL URL  
- `JWT_SECRET` — signing key for JWTs  
- `VOTE_ENCRYPTION_KEY` — 32-byte key for AES-256-GCM (store as hex or base64; see `apps/api` config)  
- `CORS_ORIGIN` — origin allowed for browser clients  
- `PORT` — API port (default `4000`)

## Database migrations

SQL files live in [`infra/sql`](infra/sql). Apply the first migration to Neon:

**Using psql** (install [PostgreSQL client](https://www.postgresql.org/download/) or use Neon SQL Editor):

```powershell
psql "YOUR_DATABASE_URL" -f infra/sql/001_initial_schema.sql
```

**Using Neon SQL Editor:** open your Neon project → **SQL Editor** → paste the contents of [`infra/sql/001_initial_schema.sql`](infra/sql/001_initial_schema.sql) → run.

### Verify API and Neon

1. Copy [`env.example`](env.example) to `apps/api/.env` and set a real `DATABASE_URL` from the Neon dashboard (connection string with `sslmode=require`).
2. Ensure `JWT_SECRET` (≥32 characters) and `VOTE_ENCRYPTION_KEY` (64 hex chars or 32-byte base64) are set.
3. Start the API: `npm run dev:api`
4. Request the health endpoint:

```powershell
curl -s http://localhost:4000/health
```

Expected JSON when the database is reachable:

```json
{"ok":true,"database":"up"}
```

If `DATABASE_URL` is wrong or the DB is down, the server still starts; `/health` returns `500` and the API logs the PostgreSQL error—check SSL, firewall, and that the migration ran successfully.

## Workspace scripts

| Script | Description |
|--------|-------------|
| `npm run dev:api` | Run API in development with hot reload |
| `npm run dev:web` | Run Next.js dev server |
| `npm run build:api` | Build API to `dist/` |
| `npm run build:web` | Production build for web |

## License

Private / proprietary unless otherwise stated.
