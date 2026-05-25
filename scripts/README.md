# Scripts

Repo-owned tooling lives in `scripts/` and uses node-native `*.mjs` entrypoints.

## Layout

- `scripts/lib/` shared helpers with clear ownership
- `scripts/ci/` CI-only guards and workflow helpers
- `scripts/dev/` local developer orchestration
- `scripts/deploy/` deploy and publish flows
- `scripts/docs/` generated and curated docs tooling
- `scripts/release/` release packaging and distribution helpers

## Rules

- Keep `package.json` scripts as thin aliases only.
- Keep workflow YAML glue thin; move non-trivial logic into `scripts/`.
- Keep `.codex/skills/**/scripts/` as thin wrappers or skill-local helpers, not a second tooling root.
- Put package-owned tooling under `packages/*/scripts/` when it depends on package internals.
