---
name: open-pr-and-monitor
description: Open or reuse a repo PR and monitor it with a five-minute Codex heartbeat until it is ready, terminal, or blocked.
---

# Open PR and Monitor

## Read

- `AGENTS.md`
- `$develop-a-feature` for fix waves
- `$commit-a-change` before committing
- `wait_for_pr_feedback.mjs --help`

## Workflow

1. Open a PR or resolve the existing PR. For a new PR, require a clean tree, fetch `origin/main`, stop on `main`, review `origin/main..HEAD`, run the narrow validation the diff needs, push, and open against `main`. Use a commit-format title, a short body, `Closes #<number>` when applicable, and ready-for-review unless the user asked for draft.
2. Return the clickable PR URL immediately.
3. Pin the current head SHA. Use `automation_update` to create or update one Codex heartbeat on the current thread to run every five minutes. Do not create a detached automation or duplicate heartbeat.
4. The heartbeat prompt must name this skill, the PR URL or number, and the pinned head SHA. On each run it must invoke the script exactly once:

   `node .codex/skills/open-pr-and-monitor/scripts/wait_for_pr_feedback.mjs --pr <number> --head-sha <sha> [--repo <owner/repo>]`

5. Use that snapshot to check every visible status, top-level comment, review, unresolved thread, and merge-readiness field. If work is still pending, end the heartbeat run without polling.
6. For actionable feedback, failures, or conflicts, inspect the exact GitHub surface and respond there. Apply valid fixes through `$develop-a-feature`, commit through `$commit-a-change`, push, then update the heartbeat prompt with the new head SHA.
7. Stop the heartbeat when the pinned head is green, actionable feedback is resolved, and merge readiness is clean; when the PR is merged or closed; or when the run is genuinely blocked or redirected.

## Output

Return only the PR URL.
