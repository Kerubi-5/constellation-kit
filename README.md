# constellation-kit

Shared infrastructure for the constellation — **metis** and **kairos**, two
sibling Next.js + Supabase services. Extracts what those repos duplicated so
each keeps a thin caller instead of a copy.

The line: this holds the shared **CI/build workflows** and **published npm
packages** for stateless or dependency-injected runtime logic. Anything bound to
a specific app — Supabase wiring, DB adapters, tool implementations, migrations —
stays in that app, so the two services keep independent deploys and blast radius.

## Reusable workflows (`workflow_call` — referenced by path, no npm)

| Workflow | Purpose | Caller supplies |
| --- | --- | --- |
| [`app-ci.yml`](.github/workflows/app-ci.yml) | Lint / typecheck / test / dead-code / build gate for the Next.js app | optional `import-alias-check`; caller keeps its own `on:` paths |
| [`release-cli.yml`](.github/workflows/release-cli.yml) | Publish a workspace CLI to npm (publish-first-then-bump), OIDC or `NPM_TOKEN` | `package` filter; `NPM_TOKEN` secret for token auth (omit for OIDC) |
| [`e2e.yml`](.github/workflows/e2e.yml) | Browser e2e on an ephemeral Supabase + Playwright | `supabase-project-id`, optional `pre-build` |
| [`skill-sync.yml`](.github/workflows/skill-sync.yml) | Sync a skill folder straight to its standalone repo's default branch (no PR) | `target-repo`, `git-name`, `git-email` |

A caller repo keeps a thin workflow that owns its `on:` triggers and delegates
the job:

```yaml
# metis/.github/workflows/skill-sync.yml
name: Sync metis-skills
on:
  push: { branches: [main], paths: ["packages/metis-skills/**"] }
  workflow_dispatch:
jobs:
  sync:
    uses: Kerubi-5/constellation-kit/.github/workflows/skill-sync.yml@main
    with:
      target-repo: metis-skills
      git-name: metis-bot
      git-email: metis-bot@users.noreply.github.com
    secrets: inherit
```

## npm packages (`packages/*` — published, `import`ed normally)

| Package | What it is | Consumed by |
| --- | --- | --- |
| [`constellation-agent-auth`](packages/agent-auth) | Single source of truth for agent API-token auth: mint / hash / format-check + the pure verify decision. Prefix-agnostic, isomorphic (`node:crypto` only). | both apps' `lib/auth/api-token.ts`; kairos's CLI `token-store.ts` |

Runtime code is shared as a **published npm package** (normal `import`, not a
git-dep). The app keeps whatever is app-specific — the DB lookup, the
service-role client — and the package owns the stateless, security-sensitive
core, so it has exactly one audited copy. Each app wraps the package with its own
prefix (`metis_sk_`, `kairos_sk_`).

**First publish is manual** (the npm account requires an OTP on every write, so a
brand-new package can't use OIDC). Version bumps of an existing package can be
automated with an OIDC trusted publisher configured on the npm package page.

## What's shared (and what deliberately isn't)

**Reusable workflows** (`workflow_call`, referenced by path — no npm, no install-time auth) are the durable dedup: every meaningful CI duplication (`app-ci`, `release-cli`, `e2e`, `skill-sync`) now lives here once, called by thin per-repo workflows that keep only their own `on:` path triggers.

**Config/code packages are intentionally NOT here.** A git-dependency on a shared package was tried for the tsconfig base and abandoned: TS's package-subpath `extends` resolves locally but fails in CI under pnpm (`TS6053`), and every other candidate hit similar friction — `vercel-ignore-build` runs before install so it can't import anything, and Prettier's tailwind plugin resolves fragilely across the dep boundary. For rarely-changing config, that's more complexity than the duplication costs.

**`agent-auth` token primitives — extracted to `constellation-agent-auth`.** The two apps' `lib/auth/api-token.ts` were byte-identical modulo the token prefix and admin-client name. A git-dep was rejected (same resolution friction as the config packages, on a prod-build-breaking path), but a **published npm package** resolves cleanly, so the token crypto now has one audited home. Each app keeps only its prefix and DB glue.

**`skill-sync` action source stays standalone.** The reusable `skill-sync.yml` here already gives the consolidation (callers reference it, not a copy). Moving the action's Docker source out of its own repo would only couple a generic tool to the constellation and force a container-registry migration with a breakage window on a working sync. Not worth it.

### Candidate: shared tool-route guard

The two apps' `app/api/ai/tools/[toolName]/route.ts` POST handlers are currently
**byte-identical** (they differ only in how the `RouteContext` type is
line-wrapped). The guard flow is the same everywhere: resolve actor → `401` →
scope-check → `403` → rate-limit → `429` → parse JSON → `400` → dispatch →
`{ ok, data }` envelope. Only the DB/app-bound pieces differ.

This can be shared from `constellation-agent-auth` as a `createToolRouteHandler`
**factory** that takes the app-specific pieces as injected dependencies:

```ts
// each app's route.ts collapses to:
export const POST = createToolRouteHandler({
  resolveActor: resolveRequestActor,   // app: hits the DB
  canUseTool: actorCanUseTool,         // app: scope check
  withinRateLimit: withinToolRateLimit,// app: rate store
  runTool,                             // app: tool dispatch
})
```

Keep it **framework-agnostic**: the factory returns a Web-standard `Response`
(which Next route handlers accept) rather than `NextResponse`, and validates the
correlation-id header with a small UUID regex — so the package stays
dependency-free and never imports `next` or `zod`. Generic over the actor type
(`<TActor extends { userId: string }>`), since the handler only reads
`actor.userId`. Ship in a `constellation-agent-auth@0.2.0`; first publish aside,
this is a clean, behavior-preserving extraction gated on both apps' CI.

### If runtime sharing keeps growing: a monorepo

Published npm packages are the right vehicle for a *handful* of stateless/
injectable pieces like the above. If the shared surface grows to many packages
that are constantly resynced across the two repos, the cheaper structure becomes
a single pnpm **monorepo** — at which point the packages become workspace
packages and the publish/version dance disappears.
