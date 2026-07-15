---
name: write-compartment-tests
description: Review, write, or refactor compartment repo tests by starting with a fast independent test-review pass, protecting behavior, using the right package-owned harness, and refusing implementation-mirror tests.
---

# Review And Write Compartment Tests

Use this skill when adding, refactoring, deleting, or reviewing tests in this repo.

Read first:

- `AGENTS.md`
- `docs/layers/test-support.md`
- the owning layer doc

Start with a review pass:

- When tool policy and the user's request allow subagents, launch one dedicated fast test-review subagent.
- Do not choose or name a model, reasoning effort, speed, latency, or quality mode in this skill.
- Let the review subagent inherit the user's current session configuration. If the client requires explicit values, pass only the current user-selected values exposed by the client/runtime.
- Prefer a subagent type that preserves the current user-selected configuration.
- Give that subagent only the relevant diff, files, or planned test surface and ask it to check for implementation-mirror coverage, missing thicker behavior coverage, wrong harness ownership, test-only seams, and over-validation.
- Keep the main agent as the integrator. While the review pass runs, the main agent may continue with ownership, harness selection, and fixture audit. Merge the findings before finalizing test edits.
- If subagents are not allowed or not available, do the same review in the main agent before editing tests.

Hard bans:

- mocked plumbing, call order, forwarded argument bags, ORM/query-builder shapes;
- command or route shells that only prove already parsed input was passed through;
- tests that only say "if I pass X and mock everything, I get mocked X back";
- any case that forces test-only exports, dependency bags, or widened runtime APIs.
  If that is all the test does, delete it or replace it with thicker coverage.

Keep:

- user-visible behavior;
- business invariants;
- boundary validation and output shaping;
- cross-layer flows covered through integration or e2e.
  Prefer one thicker behavior test over several thin mirrors.

Workflow:

1. Identify the owning package, boundary, user-visible behavior, and the smallest meaningful coverage surface.
2. Launch the fast review subagent when allowed and keep moving on ownership and harness prep in parallel; otherwise do the same review in the main agent.
3. Delete or collapse mirror tests before adding replacements.
4. Choose the thickest harness that still matches the change scope.
5. Add or refactor only the tests that protect the real contract, not the current implementation shape.

Scope:

- pure helper or service test for local invariant-only logic;
- command or route test for boundary behavior;
- package integration test for multi-step API behavior;
- DB-backed or system/e2e test for deploy, runtime, and auth flows.

Ownership:

- `@compartment/test-support`: DB lifecycle, env sandbox helpers, and free ports.
- package `test/`: command, route, integration, and system-test harnesses.
- `*-test.fixtures.ts`: repeated builders and fixtures.
- `*-test.harness.ts`: repeated execution helpers.

Copy these patterns:

- `packages/cli/test/cli-test.harness.ts`
- `packages/cli/test/cli-test.fixtures.ts`
- `packages/api/test/api-route-test.harness.ts`
- `packages/api/test/api-integration.harness.ts`

Boundaries:

- no new cross-package relative imports in tests;
- no runtime exports only for tests;
- if a cross-package dependency is unavoidable, declare it in the owning package `package.json`.

Validate:

- run narrow `pnpm lint`, `pnpm typecheck`, `pnpm test`;
- let `git commit` run the repo-wide hook checks, and keep manual validation here focused on the current test surface;
- run `pnpm test:db` for DB-backed API integration or CLI smoke flows;
- run the focused k3d e2e suite for deploy or runtime changes;
- when browser-visible compartment coverage matters, and the current run is not already the delegated smoke pass, prefer delegating `$compartment-smoke-test` to a dedicated fast subagent that inherits the user's current session configuration once local checks are stable;
- if subagents are not allowed or not available, run the smoke directly or state clearly that browser smoke remains unrun;
