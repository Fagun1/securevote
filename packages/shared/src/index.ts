/** Shared constants and types for SecureVote AI API and web clients. */

export const ROLES = ["voter", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];
