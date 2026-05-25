---
name: open-pr-and-monitor
description: Open or reuse a repo PR, then monitor checks, merge readiness, and review feedback until the PR is done, blocked, or redirected.
---

# Open PR and Monitor

Use when the user wants PR creation or PR follow-up through terminal outcome.

Before anything else, remove plumbing tests: delete tests that only assert mocked forwarding, call chains, or implementation plumbing without protecting boundary-level behavior.

## Read

- `AGENTS.md`
- `$develop-a-feature` only for fix waves
- `$commit-a-change` only before committing
- Use `wait_for_pr_feedback.mjs --help`; read skill-local script source only when debugging it.

## Algorithm

1. Resolve the mode: open a new PR or reuse an existing one.
2. For a new PR, require a clean tree, `git fetch origin main`, stop on `main`, review `origin/main..HEAD`, run the narrow validation the diff needs, choose the PR title from the full branch meaning in commit format `type(scope): subject`, push, and open against `main`. Keep the PR body short: what changed, user flow or UX, and new commands or routes if any. If the work is for a GitHub issue, include `Closes #<issue-number>` in the PR body. Do not fill the PR body with validation notes. Default to ready-for-review unless the user asked for draft.
3. For an existing PR, resolve the PR number or URL first. If it is unexpectedly draft and the user did not ask for draft mode, convert it before monitoring.
4. As soon as the PR is opened or resolved, print one short chat line with the clickable PR link, for example `[PR #123](https://github.com/owner/repo/pull/123)`.
5. Start monitoring immediately. Pin the current PR head SHA. The wait script emits a non-blocking public-docs advisory only when mapped files may require user-action, public-contract, or operator-decision docs. If you create a monitor, prefer a Codex heartbeat on the current thread with `FREQ=MINUTELY;INTERVAL=5`; use a detached Codex automation only when the follow-up cannot stay on the current thread, and keep the same five-minute cadence there too. The monitor prompt must explicitly say to continue this PR by following `open-pr-and-monitor`. Do not create a generic reminder, do not use a broader 15-30 minute cadence, and do not resume on a different workflow. Wait between full passes with `.codex/skills/open-pr-and-monitor/scripts/wait_for_pr_feedback.mjs`, and after every push restart the loop on the new PR head.
6. On every full pass, inspect all required surfaces:
   - all visible checks and status contexts for the current head, including third-party review statuses such as `Devin Review`
   - top-level comments
   - review threads, not just `gh pr view --comments`
   - merge readiness: `mergeable`, `mergeStateStatus`, `potentialMergeCommit`, `isInMergeQueue`
7. Treat review threads and merge readiness as first-class signals. `merge-conflict` or dirty merge state is a blocker until the branch is refreshed or conflicts are resolved. If conflicts touch migrations, regenerate the migrations cleanly and never hand-edit migration files or journals to force a merge.
8. If `mergeStateStatus` is `BLOCKED` while visible checks look green, do not assume a GitHub lag first. Re-inspect all unresolved review threads and top-level comments, answer anything still hanging, and explicitly resolve every thread that is fixed, intentionally accepted, or purely informational. A blocked merge with green checks often means review feedback still needs a reply or resolution.
9. For every actionable top-level comment, reply on that exact comment or reject it with a short technical reason. For every actionable review thread, reply on that exact thread and resolve it after the fix or decision. Never leave actionable feedback silent or unresolved.
10. For every valid fix wave, change the smallest owning surface, run the narrow checks the new diff needs, commit with `$commit-a-change`, push, refresh the pinned head SHA, and return to monitoring on that new head. If monitoring was interrupted by edits, resume it immediately after the push.
11. Do not finish while any visible check or status context is pending or failing on the current head, including external review statuses such as `Devin Review`, any actionable top-level comment or review thread is unresolved on the current head, or the PR is not mergeable and clean for the current head.
12. Finish only when the current PR head is green across all visible checks and status contexts, actionable comments and threads are resolved, and merge readiness is clean, or when the run is clearly blocked or redirected by the user.

## Output

Return only:

- PR URL
- CI state
- review status
- merge status
- blocker or next action
