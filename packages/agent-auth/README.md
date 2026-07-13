# constellation-agent-auth

The single source of truth for how a constellation service (metis, kairos) mints,
hashes, and verifies its long-lived **agent API tokens** — the `<prefix>sk_…`
bearer tokens headless agents and CLIs use in place of a session.

Prefix-agnostic, so one implementation serves every service and its CLI: each
caller passes its own prefix (`metis_sk_`, `kairos_sk_`). Isomorphic — only
`node:crypto`, so it runs in the Next.js server and in a bundled Node CLI alike.

The app keeps what's inherently app-specific: the DB lookup and the `last_used_at`
stamp. This package owns the pure crypto (entropy, SHA-256, constant-time compare)
and the pure valid/invalid decision, so the security-sensitive parts have exactly
one audited copy.

```ts
import {
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  evaluateApiToken,
  type VerifiedApiToken,
} from "constellation-agent-auth"

const PREFIX = "metis_sk_"

const token = generateApiToken(PREFIX) //  metis_sk_<43 base62 chars>
const hash = hashApiToken(token) //         only the hash is ever persisted

// In verifyApiToken(), after fetching the row by token_hash:
const verified = evaluateApiToken(hash, row, new Date()) // VerifiedApiToken | null
```

## API

| Export | Purpose |
| --- | --- |
| `isApiTokenFormat(token, prefix)` | Cheap "is this an API token, not a JWT?" — no DB hit. |
| `generateApiToken(prefix)` | Mint a new `<prefix><43 base62>` token (~256 bits entropy). |
| `hashApiToken(token)` | SHA-256 hex digest — the only thing stored. |
| `evaluateApiToken(hash, row, now)` | Pure verify: constant-time compare + revoked/expired checks → `VerifiedApiToken \| null`. |
| `VerifiedApiToken`, `ApiTokenRow` | Shared types. |
