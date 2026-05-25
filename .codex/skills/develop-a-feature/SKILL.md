---
name: develop-a-feature
description: Implement repo changes by starting with a required preflight subagent, then editing the smallest owning surface on one canonical path and running only diff-triggered checks.
---

# Develop a Feature

Use for implementation work in this repo.

## Read

- `AGENTS.md`
- the owning layer doc
- `docs/specs/type-placement.md` only when type ownership may change
- `$public-docs-maintenance` only when public docs are required
- `$preflight-feature-review`

## Algorithm

1. If you are creating a branch from `main`, update local `main` first, then create the feature branch from that updated `main`.
2. Start with `$preflight-feature-review` in a dedicated subagent. Pass: the user request, the intended behavior or outcome, the likely owner or boundary if already suspected, the files or packages you expect to touch if known, and any constraints, errors, or validation needs already visible. Wait for its coding brief. Do not edit before it returns.
3. Treat product behavior as CLI-first. Before adding or changing UI behavior, find the matching CLI command and its existing SDK/API contract. The UI must reuse that existing method, or reuse and extend that same shared method/contract when the feature genuinely needs more data. Do not add a new UI-only API route, browser-only SDK method, or parallel contract for behavior that duplicates a CLI feature.
4. Resolve blockers from the brief first. Then implement only in the returned owner, boundary, and canonical path.
5. When the feature adds or changes permissions, make the default-grant and rollout decision explicit in the same change instead of leaving it implicit.
6. Change the smallest owning surface. Do not add fallback branches, compatibility glue, silent env defaults, public/internal URL mixing, export drift, or test-only seams.
7. Update tests in the same diff. Prefer behavior, boundary, integration, or e2e coverage. Delete or rewrite plumbing-mirror tests instead of shaping production code around them.
8. Invoke `$public-docs-maintenance` only when `AGENTS.md` says public docs are required. Leave `public-docs/` alone for internal-only changes; regenerate generated reference only when its source changed.
9. Run the validation matrix from preflight: owning-package `pnpm lint`, `pnpm typecheck`, and `pnpm test` when applicable, plus only the diff-triggered special checks. Do not manually run repo-wide `pnpm check`, `pnpm check:unused`, `pnpm check:unused:runtime`, or `pnpm check:ci` unless the task explicitly requires them.
10. Close out with the entry file to read first, checks run, remaining unrun validation, and the user-visible verification flow.
