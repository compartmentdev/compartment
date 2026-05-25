---
name: ship-a-feature
description: Carry an approved repo change from request to terminal PR outcome by orchestrating preflight, implementation, review, smoke, commit, and PR monitoring through the repo subagent stages without duplicating those skills.
---

# Ship a Feature

Use when the user wants the task carried through to PR completion, not just coded locally.

## Read

- `AGENTS.md`
- `$develop-a-feature`
- `$public-docs-maintenance`
- `$write-compartment-tests`
- `$review-a-change`
- `$compartment-smoke-test`
- `$commit-a-change`
- `$open-pr-and-monitor`

## Algorithm

1. Confirm the ship target: approved request, expected outcome, dedicated feature branch, and whether the task should end at local ready state or terminal PR outcome. Default to terminal PR outcome.
2. Run `$develop-a-feature` with the approved request, intended outcome, known scope, and visible constraints. Let it own the required preflight subagent, coding brief, implementation, and local validation.
3. If the changed test surface is noisy, unclear, or mirror-heavy, run `$write-compartment-tests` before review or PR handoff, then rerun only the affected checks.
4. Once the diff and local automated checks are stable, launch the final validation stage in parallel subagents:
   - a dedicated review subagent for `$review-a-change`
   - a dedicated smoke subagent for `$compartment-smoke-test` when the diff triggers browser-visible validation
5. Integrate findings from that parallel stage and fix actionable issues before PR handoff.
6. Use `$commit-a-change` for each commit that should survive review.
7. Run `$public-docs-maintenance` before PR handoff only when `AGENTS.md` says public docs are required.
8. When the branch is locally ready, hand it to `$open-pr-and-monitor`. Let that skill own PR creation or reuse, CI, review replies, follow-up fix waves, and terminal PR state.
9. Do not stop at local green state if PR orchestration has not started. Finish only on success, blocker, or user redirect.

## Output

Return only:

- current stage
- validation that ran
- review status
- PR URL and state, or the blocker
