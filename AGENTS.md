# AGENTS.md

## Purpose

Instructions for coding agents working in this repository.

Keep changes small, explicit, and package-owned.

## Product Direction

- Compartment is CLI-first: new product workflows start from the CLI command and its SDK/API contract.
- The console is a control-plane browser surface over shared contracts. For CLI-owned behavior, reuse or extend the same SDK/API primitive instead of adding UI-only routes, browser-only SDK methods, or parallel contracts.

## Rules

- Write every repository artifact in English: code, comments, docs, tests, commit messages, and PR titles/bodies. CI rejects Cyrillic text (`pnpm check:no-cyrillic`).
- Find the owning package before editing code.
- Read the relevant file under `docs/layers/` before changing code in that layer.
- Treat `docs/layers/*` and `docs/specs/type-placement.md` as the source of truth for ownership, boundaries, and type placement.
- If the request requires a boundary violation, duplicated logic in another package, or a new cross-package shortcut, stop and propose the refactor first.
- Change one owning surface that fully solves the request. Do not patch the same behavior in multiple packages.
- Declare real cross-package dependencies in the owning package `package.json`. Keep TypeScript `paths` package-local. Do not add repo-wide cross-package `paths`.
- Keep public ingress explicit. Expose only documented public hosts and paths.
- Never expose `/internal/*`, internal-token routes, or control-plane health routes through public ingress. Internal services must use internal hosts or internal URLs.
- In a git worktree, install dependencies in that worktree before coding or committing.
- when a change adds or alters permissions, explicitly decide in the same change whether existing or seeded principals/groups get that permission by default and how fresh-install or migration rollout should handle it.

## Code

- Public contract types must be explicit named interfaces or types.
- Do not leave anonymous object types in code. Extract named types into adjacent `*.types.ts`.
- Keep routes and commands thin: validate input, map transport concerns, and call application code directly.
- Keep business logic in services. Services must not import or throw HTTP-specific errors.
- Keep DB reads and writes in adjacent `queries/` modules, not in services.
- Validate optional or missing input at the boundary once. Downstream helpers must take required values and must not re-check impossible states.
- For env-file-backed runtime config, required values are required. Fail fast on missing or malformed values. Do not add silent defaults.
- Use one port variable and one URL variable per connectivity path. Do not add alias env variables for the same target.
- Do not add `*Dependencies` bags, singleton wrappers for `db` or `config`, or test-only production parameters. Add test seams behind package-local adapters or module boundaries.
- Use one canonical identifier in selection flows. Do not accept `id | slug | name` fallback matching.
- In `v0`, do not create a `domain` package.
- Do not add `eslint-disable` comments unless the user or a developer instruction explicitly asks for them.

## Update Together

- Update tests in the same change only when they protect changed behavior, contracts, migrations, CLI output, auth/org context, or meaningful integration/e2e flows; do not add tests that only mirror implementation, assert mocked forwarding or call chains, or lock in plumbing without boundary-level behavior.
- When a change produces something a consumer outside this process reads, assert the artifact in the form that consumer receives it: the request body the Kubernetes client serializes, the rendered chart, the adapted Caddy config, the file present in the built image. Asserting the in-memory object or the source text proves nothing about what ships.
- Derive a test expectation from the production source. A literal restated in both the test and the production path agrees with itself while production disagrees with the cluster, which is how tenant isolation shipped broken under a green suite.
- A test that can skip itself must fail in CI when its prerequisite is missing. A silent skip reads as coverage and is not.
- If you change a contract schema, update SDK consumers and contract tests.
- If you change a DB schema, update migrations and affected API tests.
- If you change CLI JSON output, update fixtures and smoke tests.
- If you change auth or organization-context logic, update API, CLI, and integration tests together.
- Public docs are required only when users must change behavior, understand a public contract, or make an operator decision. For internal-only changes, do not add `public-docs/`; regenerate generated reference only when its source changed.
- If you add or change a public route that handles authentication, tokens, passwords, invites, login codes, sessions, or organization membership, make an explicit abuse-protection decision in the same change: rate limit, cooldown, or a written reason why neither is needed.

## Validation

- Before finishing, run the narrowest relevant checks in the owning package: `pnpm lint`, `pnpm typecheck`, and tests changed by the diff or likely to regress. Do not run unrelated full suites by default.
- When editing root `scripts/`, run `pnpm lint:scripts`, `pnpm typecheck:scripts`, and `pnpm test:scripts`.
- Run targeted DB tests for DB-backed changes. Run the full `pnpm test:db` only when shared DB/test infrastructure, migrations, or broad integration behavior may regress, or when explicitly required.
- Run the focused k3d e2e suite only for deploy, build, or runtime changes.
- Run `pnpm check:ci` only when the user explicitly asks for CI-parity validation or the task explicitly requires it.
- `git commit` already runs `pnpm lint-staged`, `pnpm check`, and `pnpm check:duplicates`. Do not run broad repo checks by default.

## Repo Notes

- Repo Codex skills live only under `.codex/skills/`.
- When opening or monitoring a pull request, use `.codex/skills/open-pr-and-monitor`.
- For repo code review, use `.codex/skills/review-a-change`.
- Public user docs live only under `public-docs/`. Engineering docs live under `docs/`.
- Keep repo-wide agent guidance in this file. Keep skill-specific workflows under `.codex/skills/`.
- Local secrets do not belong in committed `.env` files.
- Local development uses env-configured PostgreSQL, not Docker-based infra.
