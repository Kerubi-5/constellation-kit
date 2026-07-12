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
| [`skill-sync.yml`](.github/workflows/skill-sync.yml) | Sync a skill folder out to its standalone repo, open a PR | `target-repo`, `git-name`, `git-email` |

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

## Roadmap

- `e2e.yml` reusable workflow (Supabase + Playwright) — the largest duplication.
- `app-ci.yml`, `release-cli.yml` reusable workflows.
- `packages/config` — shared ESLint rules, Prettier, tsconfig base (git-installable).
- `packages/deploy` — `vercel-ignore-build`, `env:check`.
- `packages/agent-auth` — pure token/envelope/scope-check primitives.
- Absorb the `skill-sync` docker action source here.
