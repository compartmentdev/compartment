---
name: review-a-change
description: Use when the user invokes $review-a-change or asks for a compartment repo code review; always use the delegated subagent review path by splitting review into separate parallel passes for contracts, architecture, runtime surface, validation, and changed slices, then report findings first with file and line references.
---

# Review a Change

Use this skill for code review in the compartment repo.

## Invocation notes

- `$review-a-change` is the explicit skill invocation.
- `/review` may be a client built-in command rather than this skill. Do not rely on `/review` alone to load this skill or to grant subagent permission.
- This skill requires the delegated subagent path for every review. Do not run a main-agent-only fallback.

## Source of truth

- `AGENTS.md`
- `docs/layers/README.md`
- the short layer doc for each touched owning package
- `docs/specs/type-placement.md` when types move or ownership is part of the review
- `$public-docs-maintenance` only when public docs may be required

## Review workflow

1. Identify the owning package, entry boundary, contracts, runtime surface, and the single canonical path touched by the change.
2. Always launch separate subagents for the independent passes below and keep the main agent as the integrator. Do not choose or name a model, reasoning effort, speed, latency, or quality mode in this skill.
3. Let review subagents inherit the user's current session configuration. If the client requires explicit values, pass only the current user-selected values exposed by the client/runtime. Prefer a subagent type that preserves that configuration.
4. Start these required subagents in parallel. If the client only allows sequential spawn calls, start them one after another before reviewing:
   - contracts-and-architecture: package ownership, layer fit, contracts, type placement, boundary drift, API shape, hidden fallback paths, and the documented public ingress contract. This pass must run `$audit-type-ownership` even when you expect no findings.
   - runtime-hygiene: exports, entrypoints, scaffolding, dead runtime surface, hidden compatibility branches, and public-surface expansion such as new host aliases or externally reachable internal paths. This pass must run `$compartment-runtime-hygiene` even when runtime changes look incidental.
   - docs-drift: missing or misleading public docs only when users must change behavior, understand a public contract, or make an operator decision; generated reference drift; and proposal-only language leaking into the public site. This pass must use `$public-docs-maintenance` as the policy source and must not edit docs.
   - validation: missing tests, wrong test depth, missing migrations, missing fixtures, and missing DB or Docker checks.
5. Split the remaining changed surface into 1 to 3 additional slice subagents by owning package or boundary, not by arbitrary file count. Ask each slice pass to look only for bugs, regressions, clean-code issues, oversized functions, and KISS drift inside its slice.
6. For tiny diffs, still run the contracts, runtime-hygiene, and validation subagents plus at least one slice subagent. Do not collapse back to one slow serial review.
7. Tell each subagent to return findings only, with file and line references, and not to edit files or resolve findings.
8. If the current agent is already one of the delegated review subagents, run only the assigned pass and do not re-delegate.
9. Do not perform a main-agent-only fallback or do the same review dimensions serially.
10. Treat any new fallback behavior, alternate selection path, or legacy compatibility check as a finding unless the diff or request makes that path explicit and necessary.
11. Treat any new or widened external exposure of `/internal/*`, internal-token routes, control-plane health probes, undocumented public host aliases, or internal/public URL mixing as a blocking security finding, not an advisory note.
12. Check architecture fit before commenting on local style.
13. Review the smallest correct surface, not just whether the code works.
14. Integrate all passes into one deduplicated findings list ordered by severity, then do one short main-agent sweep for cross-slice interactions that the parallel passes could miss.
15. If a review finds a real issue that should not be fixed in the current PR, keep it explicit in the review findings or PR discussion. Create a GitHub follow-up issue only when the user asks for issue tracking or the current PR workflow explicitly requires it.

## Review focus

- architecture or layer ownership drift;
- guessed, broadened, or duplicated contracts, including `id | slug | name` fallback matching and public types hidden behind inference;
- hidden or unagreed fallback paths, speculative compatibility branches, and duplicated legacy checks added without a stated contract;
- KISS regressions where the change introduces extra branching or duplicate logic instead of keeping one canonical path;
- production APIs widened for tests instead of using package-local seams;
- clean-code regressions such as muddled orchestration, hidden state coupling, or misleading output/debug surfaces;
- public ingress drift such as externally reachable internal URLs, internal-token routes on public hosts, control-plane health probes exposed through public ingress, internal callers using public URLs, or undocumented host aliases and wildcard expansion;
- docs drift where `AGENTS.md` requires public docs but they are absent or misleading;
- oversized or unsplit source files that hide the real change surface;
- dead runtime surface from exports, entrypoints, or scaffolding;
- missing DB migrations when schema or persisted shape changed;
- missing tests or the wrong validation depth for the scope.

## Output

- Report findings first, ordered by severity, with file and line references.
- Focus on bugs, regressions, architecture drift, and missing tests or checks.
- Call out hidden fallback or legacy paths explicitly instead of treating them as harmless defensive code.
- If there are no findings, say so explicitly and mention any residual risk briefly.
- When you intentionally defer a valid issue, make the deferment explicit in the review output and note any follow-up issue only if one was actually created.
