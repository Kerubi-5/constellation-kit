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
| [`e2e.yml`](.github/workflows/e2e.yml) | Browser e2e on an ephemeral Supabase + Playwright | `supabase-project-id`, optional `pre-build` |

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

**Reusable workflows** (`workflow_call`, referenced by path — no npm, no install-time auth) are the durable dedup: the biggest CI duplications (`e2e`, `skill-sync`) now live here once, called by thin per-repo workflows.

**Config/code packages are intentionally NOT here.** A git-dependency on a shared package was tried for the tsconfig base and abandoned: TS's package-subpath `extends` resolves locally but fails in CI under pnpm (`TS6053`), and every other candidate hit similar friction — `vercel-ignore-build` runs before install so it can't import anything, and Prettier's tailwind plugin resolves fragilely across the dep boundary. For rarely-changing config, that's more complexity than the duplication costs. If a shared runtime package ever becomes worth it (e.g. the agent-auth token primitives), publish it to npm via OIDC rather than a git-dep — npm resolution is clean where git-subdir isn't.
