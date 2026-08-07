---
name: preflight-feature-review
description: Review a proposed Compartment change before implementation with three parallel read-only subagents covering the simplest complete solution, correct module placement, and reuse of established libraries.
---

# Preflight Feature Review

Launch exactly three parallel Luna Max subagents. Give each the current request and known scope. Use only these cheap agents; they must inspect only: no edits, installs, builds, lint, typecheck, tests, or further delegation.

1. **Simplest implementation**: inspect the relevant code and propose the smallest implementation that fully meets the current requirements. Call out anything the simple approach would miss.
2. **Placement**: inspect `AGENTS.md`, the relevant layer docs, and nearby modules. Identify the owning package or module, exact placement, and boundaries that must remain intact.
3. **Reuse**: inspect existing helpers and dependencies, then decide whether established code or a well-known library should replace custom implementation. Verify any new library from primary sources; recommend it without installing it. Say when custom code is simpler.

Wait for all three, resolve contradictions, and return only:

- `Simplest`: recommended implementation and why it is complete
- `Placement`: owner, files, and boundary guidance
- `Reuse`: existing helper, dependency, verified library, or custom code
- `Blockers`: only genuine blockers, otherwise `none`
