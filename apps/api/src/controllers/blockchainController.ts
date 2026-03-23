import type { Pool } from "pg";
import type { Env } from "../config/env.js";
import { validateChainIntegrity } from "../services/blockchainService.js";

export function createBlockchainController(env: Env, pool: Pool) {
  async function validate() {
    return validateChainIntegrity(env, pool);
  }

  return { validate };
}

