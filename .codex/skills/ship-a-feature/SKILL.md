---
name: ship-a-feature
description: Carry an approved repo change from request to terminal PR outcome by orchestrating preflight, implementation, review, commit, and PR monitoring without duplicating those skills.
---

# Ship a Feature

Use when the user wants the task carried through to PR completion, not just coded locally.

## Read

- `AGENTS.md`
- `$develop-a-feature`
- `$review-a-change`
- `$commit-a-change`
- `$open-pr-and-monitor`

## Algorithm

1. Confirm the ship target: approved request, expected outcome, dedicated feature branch, and whether the task should end at local ready state or terminal PR outcome. Default to terminal PR outcome.
2. Run `$develop-a-feature` with the approved request, intended outcome, known scope, and visible constraints. Let it own preflight, implementation, and local validation.
3. Once the diff and local automated checks are stable, run `$review-a-change` and fix actionable findings before PR handoff.
4. Use `$commit-a-change` for each commit that should survive review.
5. When the branch is locally ready, hand it to `$open-pr-and-monitor`. Let that skill own PR creation or reuse, CI, review replies, follow-up fix waves, and terminal PR state.
6. Do not stop at local green state if PR orchestration has not started. Finish only on success, blocker, or user redirect.

## Output

Return only:

- current stage
- validation that ran
- review status
- PR URL and state, or the blocker
