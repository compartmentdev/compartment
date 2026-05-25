---
name: preflight-feature-review
description: Run a required subagent preflight before implementation and return a short coding brief: where to edit, what to avoid, what lint or runtime traps matter, and what to validate.
---

# Preflight Feature Review

Use before every implementation task in this repo.

Goal: make the main implementation agent write the first version close to final instead of discovering ownership, runtime, and lint problems after the code exists.

## Read

- `AGENTS.md`
- `docs/layers/README.md`
- relevant layer docs
- `docs/specs/type-placement.md` only when type ownership may change
- `$public-docs-maintenance` only when public docs may be required

## Algorithm

1. Run this in a dedicated subagent. Do not silently replace it with a local pass.
2. Treat the received plan as a hypothesis. Confirm or correct it before any code is written.
3. Find the owner, entry boundary, smallest correct surface, and single canonical path.
4. Check triggers: contracts, shared types, exports, entrypoints, scaffolding, env, ingress, migrations, auth, or org context.
5. If the change adds or alters permissions, require an explicit default-grant and rollout decision in the brief.
6. Pull `$audit-type-ownership` for cross-package type ownership or type moves. Pull `$compartment-runtime-hygiene` when runtime surface may change.
7. Read adjacent code and tests in the owning package. Check the owning-package lint surface before edits so the brief reflects real local constraints and any baseline failures.
8. Return one short coding brief for the main agent:
   - `Write in`: owner, boundary, files or layer
   - `Keep`: canonical path, contracts, runtime rules
   - `Avoid`: fallback paths, test seams, export drift, likely lint traps
   - `Docs`: `none` | `reference-only` | `curated`, plus the exact `public-docs/` pages and any nav or generated-reference surfaces in scope
   - `Validate`: exact checks and test depth
   - `Blockers`: anything that must be resolved before edits

Editing starts only after the brief is back and blockers are closed.
