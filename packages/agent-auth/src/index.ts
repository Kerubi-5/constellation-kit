import { createHash, randomInt, timingSafeEqual } from "node:crypto"

export * from "./tool-route"

/**
 * constellation-agent-auth — the single source of truth for how a constellation
 * service mints, hashes, and verifies its long-lived agent API tokens
 * (`<prefix>sk_…`). Prefix-agnostic: each app passes its own prefix
 * (`metis_sk_`, `kairos_sk_`), so one implementation serves every service and
 * its CLI. Isomorphic — only `node:crypto`, so it runs in the Next.js server
 * and in a Node CLI bundle alike.
 *
 * What stays in the app: the actual DB lookup and the `last_used_at` stamp.
 * This package owns the pure crypto and the pure valid/invalid decision, so the
 * security-sensitive parts have exactly one audited copy.
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** 43 base62 chars ≈ 256 bits (≥ 32 bytes) of unbiased entropy. */
const TOKEN_BODY_LENGTH = 43

/** True when a bearer value is an API token (not a JWT) — cheap, no DB hit. */
export function isApiTokenFormat(token: string, prefix: string): boolean {
  return token.startsWith(prefix)
}

/** Mints a new high-entropy token: `<prefix><base62>`. */
export function generateApiToken(prefix: string): string {
  let body = ""
  for (let i = 0; i < TOKEN_BODY_LENGTH; i++) {
    body += BASE62[randomInt(BASE62.length)]
  }
  return prefix + body
}

/** SHA-256 hex digest — only this is persisted, never the plaintext. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export type VerifiedApiToken = {
  userId: string
  tokenId: string
  /** Allowed tool names; `null` = full access. */
  scopes: string[] | null
}

/** The columns an app must select from its `api_tokens` row for verification. */
export type ApiTokenRow = {
  id: string
  user_id: string
  token_hash: string
  scopes: string[] | null
  revoked_at: string | null
  expires_at: string | null
}

/**
 * Pure verification: given the freshly computed hash and the fetched token row,
 * decide whether it grants access. The caller does the DB fetch (by `token_hash`)
 * and the best-effort `last_used_at` stamp; this owns the constant-time compare
 * and the revoked/expired checks. Returns the owning user + scopes, or `null`.
 */
export function evaluateApiToken(
  computedHash: string,
  row: ApiTokenRow | null,
  now: Date
): VerifiedApiToken | null {
  if (!row) return null

  // Defense-in-depth constant-time compare (the indexed lookup already matched).
  const stored = Buffer.from(row.token_hash, "hex")
  const computed = Buffer.from(computedHash, "hex")
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) {
    return null
  }

  if (row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at) <= now) return null

  return { userId: row.user_id, tokenId: row.id, scopes: row.scopes ?? null }
}
