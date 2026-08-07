---
name: ship-a-feature
description: Carry an approved repo change from request to monitored PR handoff by orchestrating preflight, implementation, review, commit, and PR creation without duplicating those skills.
---

# Ship a Feature

Use when the user wants the task implemented and handed to a monitored PR, not just coded locally.

## Read

- `AGENTS.md`
- `$develop-a-feature`
- `$review-a-change`
- `$commit-a-change`
- `$open-pr-and-monitor`

## Algorithm

1. Confirm the ship target: approved request, expected outcome, dedicated feature branch, and whether the task should end at local ready state or monitored PR handoff. Default to monitored PR handoff.
2. Run `$develop-a-feature` with the approved request, intended outcome, known scope, and visible constraints. Let it own preflight, implementation, and local validation.
3. Once the diff and local automated checks are stable, run `$review-a-change` and fix actionable findings before PR handoff.
4. Use `$commit-a-change` for each commit that should survive review.
5. When the branch is locally ready, hand it to `$open-pr-and-monitor`. Let that skill open or reuse the PR, return its URL, and start the monitoring heartbeat.
6. Finish when the monitored PR handoff starts, or when blocked or redirected before a PR can be opened.

## Output

Return only the PR URL, or the blocker if no PR was opened.
