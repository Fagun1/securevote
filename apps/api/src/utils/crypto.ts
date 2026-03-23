import crypto from "node:crypto";

function looksLikeHex32Bytes(key: string): boolean {
  // 32 bytes in hex => 64 chars
  return /^[0-9a-fA-F]{64}$/.test(key);
}

/**
 * Parses VOTE_ENCRYPTION_KEY into a 32-byte Buffer.
 * Supports:
 *  - 64-char hex string
 *  - base64 that decodes to exactly 32 bytes
 */
export function parseAes256Key(keyStr: string): Buffer {
  const s = keyStr.trim();
  if (looksLikeHex32Bytes(s)) {
    return Buffer.from(s, "hex");
  }
  const decoded = Buffer.from(s, "base64");
  if (decoded.length !== 32) {
    throw new Error("VOTE_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return decoded;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * AES-256-GCM encryption.
 * Output format (base64): iv(12) || tag(16) || ciphertext
 */
export function encryptAesGcm(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12); // recommended nonce size for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptAesGcm(payloadB64: string, key: Buffer): string {
  const raw = Buffer.from(payloadB64, "base64");
  if (raw.length < 12 + 16) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return plaintext;
}

