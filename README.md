# constellation-kit

Shared infrastructure for the constellation — **metis** and **kairos**, two
sibling Next.js + Supabase services. Extracts what those repos duplicated so
each keeps a thin caller instead of a copy.

The line: this holds what runs **before** production (CI, build tooling, pure
stateless helpers). Production runtime — Supabase wiring, middleware, tool
definitions, migrations — stays in each app, so the two services keep
independent deploys and blast radius.

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

## What's shared (and what deliberately isn't)

**Reusable workflows** (`workflow_call`, referenced by path — no npm, no install-time auth) are the durable dedup: every meaningful CI duplication (`app-ci`, `release-cli`, `e2e`, `skill-sync`) now lives here once, called by thin per-repo workflows that keep only their own `on:` path triggers.

**Config/code packages are intentionally NOT here.** A git-dependency on a shared package was tried for the tsconfig base and abandoned: TS's package-subpath `extends` resolves locally but fails in CI under pnpm (`TS6053`), and every other candidate hit similar friction — `vercel-ignore-build` runs before install so it can't import anything, and Prettier's tailwind plugin resolves fragilely across the dep boundary. For rarely-changing config, that's more complexity than the duplication costs.

**`agent-auth` token primitives — assessed, deliberately left duplicated.** The two apps' `lib/auth/api-token.ts` are byte-identical modulo the token prefix (`metis_sk_` / `kairos_sk_`) and the admin-client name. Tempting to share — but it's ~77 lines of stable, security-sensitive code on the production auth path of two independently-deployed apps, and the only sharing mechanisms available across separate repos are a git-dep (the friction above, now on a prod-build-breaking path instead of just CI) or an npm package (a supply-chain link + release cadence for code that never changes). The maintenance saved is ~zero; the moving parts added are not. Left as-is. The real vehicle for sharing *runtime* code between these services is a **monorepo** — see below.

**`skill-sync` action source stays standalone.** The reusable `skill-sync.yml` here already gives the consolidation (callers reference it, not a copy). Moving the action's Docker source out of its own repo would only couple a generic tool to the constellation and force a container-registry migration with a breakage window on a working sync. Not worth it.

### The real consolidation is a monorepo

Reusable workflows share everything that runs *before* prod cleanly. Sharing prod *runtime* code (auth, adapters, tool defs) across two separate repos always costs more than it saves, because every mechanism (git-dep, npm) adds resolution or supply-chain friction. If runtime-code duplication ever becomes painful enough to act on, the answer is to merge metis and kairos into one pnpm monorepo — not to keep bolting packages onto two repos.
