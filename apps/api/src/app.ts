import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Pool } from "pg";
import type { Env } from "./config/env.js";
import { errorHandler, HttpError } from "./middleware/errorHandler.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { candidateRoutes } from "./routes/candidateRoutes.js";
import { electionRoutes } from "./routes/electionRoutes.js";
import { votingRoutes } from "./routes/votingRoutes.js";
import { analyticsRoutes } from "./routes/analyticsRoutes.js";
import { blockchainRoutes } from "./routes/blockchainRoutes.js";

export function createApp(env: Env, pool: Pool): express.Application {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  // Login/register can include webcam frames encoded as base64.
  // Increase limit so liveness frames don't fail with 413.
  app.use(express.json({ limit: "25mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Avoid browser console 404s during development (Next.js will provide pages later).
  app.get("/", (_req, res) => res.json({ name: "SecureVote AI API", status: "ok" }));
  app.get("/favicon.ico", (_req, res) => res.status(204).end());

  app.use(authRoutes(env, pool));
  app.use(candidateRoutes(env, pool));
  app.use(electionRoutes(env, pool));
  app.use(votingRoutes(env, pool));
  app.use(analyticsRoutes(env, pool));
  app.use(blockchainRoutes(env, pool));
  app.use(healthRoutes(pool));

  app.use((_req, _res, next) => {
    next(new HttpError(404, "Not found"));
  });

  app.use(errorHandler);
  return app;
}
