---
name: compartment-runtime-hygiene
description: Handle export, entrypoint, scaffolding, or deletion changes that can create dead runtime surface or Knip runtime drift in the compartment repo.
---

# Compartment Runtime Hygiene

Use this skill only for runtime-surface changes.

## Source of truth

- `AGENTS.md`
- `docs/layers/README.md`

## Workflow

1. Treat code reachable only from tests as dead runtime surface.
2. Remove, internalize, or move helpers that were exported only to satisfy tests.
3. Keep runtime entrypoints explicit. Update `knip.runtime.jsonc` only for real runtime entrypoints, not convenience exports.
4. When `git commit` runs, the repo-wide hook checks start automatically, so add narrow package checks for the touched surface and add special checks only when the diff needs more than that hook covers.
5. When deletions or refactors expose implementation-mirror tests, delete or rewrite those tests instead of preserving dead runtime seams for them.
6. Do not keep exports, wrappers, dependency seams, or compatibility glue alive solely because mock-heavy plumbing tests depend on them.

## Common repo-specific smells

- package entry exports that nobody in runtime imports;
- helpers only referenced from tests;
- public type re-exports that widen a package entry surface with no runtime need;
- script helpers exported even though the file itself is the only caller.
- tests that only assert exact collaborator forwarding, ORM/query-builder choreography, or CLI/route plumbing rather than runtime behavior.
