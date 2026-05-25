---
name: commit-a-change
description: Prepare a compartment repo commit that matches commitlint type and scope rules and runs through Husky validation.
---

# Commit a Change

Use this skill when the user asks to commit work in the compartment repo.

## Source of truth

- `commitlint.config.cjs`
- `.husky/pre-commit`
- `.husky/commit-msg`

## Rules

- Allowed `type` values are in `type-enum`; allowed `scope` values are in `scope-enum`.
- Commit format is `type(scope): subject`, with a header no longer than 100 characters.
- Treat the final commit header as the canonical change title for later PR creation unless the user explicitly asks for a different PR title.
- During `git commit`, `.husky/pre-commit` starts `pnpm lint-staged`, `pnpm check`, and `pnpm check:duplicates`, so manual validation before commit should stay limited to the checks that matter for the current diff.
- Use non-interactive `git commit -m ...`; if Husky blocks the commit, fix the failure and retry with a new non-interactive commit.
- Never skip Husky hooks; do not use `--no-verify`.
