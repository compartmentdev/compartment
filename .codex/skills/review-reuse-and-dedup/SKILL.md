---
name: review-reuse-and-dedup
description: Use when reviewing compartment repo changes for existing helper reuse, extractable pure utilities, duplicated logic, repeated constants, hardcoded values, or repeated variable derivations that should be simplified in the owning package or packages/utils.
---

# Review Reuse and Dedup

## Overview

Review a change for unnecessary repetition and missed reuse. The goal is to find actionable simplifications that make the changed code smaller and more canonical without turning `packages/utils` into a dumping ground.

## What to Check

- Existing helpers or constants that should be used instead of reimplementing equivalent logic.
- Repeated parsing, normalization, formatting, URL construction, string handling, env handling, or primitive predicates.
- Duplicated literals such as route paths, header names, status names, env keys, magic numbers, file paths, and error strings.
- Repeated variable derivations or branching rules that could be named once in the owning layer.
- New helpers that are pure, primitive, cross-package, and already shared enough to belong in `packages/utils`.
- Package-specific helpers that should stay adjacent to the owning API, CLI, worker, edge, docker, kube-runtime, SDK, or contracts layer.

## Review Rules

- Prefer using an existing exported helper before suggesting a new helper. Name the export and file path when one exists.
- Suggest `packages/utils` only for tiny pure helpers over primitive runtime values with no DTO, DB, transport, protocol, or business ownership.
- Prefer package-local extraction for repeated domain rules, command formatting, HTTP mapping, DTO shaping, or layer-owned constants.
- Do not suggest extracting one-off expressions, obvious inline code, or speculative abstractions.
- Do not report a duplicate unless the suggested replacement is clearer and meaningfully reduces repeated behavior or contract drift.
- Treat tests like production only when the duplication hides intent or repeats a nontrivial fixture/helper that should be shared by the owning test harness.
- If confidence is below 0.7, do not report a finding.

## Sources to Inspect

- `packages/utils/src/index.ts` and the exported helper source files.
- The changed files and their neighboring helpers in the same package.
- `packages/api/test/api-db-test.harness.ts` before allowing per-file DB lifecycle setup in API tests.
- `packages/api/test/api-auth-session-test.fixtures.ts` before allowing file-local auth/session test helpers in API tests.
- `packages/test-support/src/api-migrations.ts` before allowing local migration wrappers in API or CLI tests.
- `packages/cli/test/self-hosted-user-setup.e2e.harness.ts` and neighboring `self-hosted-user-setup*.harness.ts` files before allowing per-file self-hosted user-flow e2e bootstrap, CLI login, app probe, or polling code.
- `docs/layers/utils.md` before recommending a cross-package utility.
- The relevant layer doc for any package where extraction or reuse is suggested.
