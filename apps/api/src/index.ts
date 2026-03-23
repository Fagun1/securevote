import { createServer } from "node:http";
import { config as loadDotEnv } from "dotenv";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, getPool } from "./db/pool.js";
import { Server } from "socket.io";
import { verifyJwt } from "./utils/jwt.js";
import { createAnalyticsController } from "./controllers/analyticsController.js";

// Load apps/api/.env into process.env before validating with Zod.
loadDotEnv();

const env = loadEnv();
const pool = getPool(env);
const app = createApp(env, pool);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: env.CORS_ORIGIN, credentials: true },
});
app.set("io", io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || token.length < 1) return next(new Error("Missing auth token"));
  try {
    const claims = verifyJwt(env, token);
    if (!["admin", "super_admin"].includes(claims.role)) return next(new Error("Forbidden"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).auth = claims;
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const ac = createAnalyticsController(env, pool);
  socket.join("admins");

  socket.on("dashboard:getSnapshot", async () => {
    const snapshot = await ac.analytics();
    socket.emit("dashboard:snapshot", snapshot);
  });
});

const port = env.PORT;
httpServer.listen(port, () => {
  console.log(`SecureVote API listening on http://localhost:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
  await io.close();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
