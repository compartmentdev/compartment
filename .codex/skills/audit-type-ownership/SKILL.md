---
name: audit-type-ownership
description: 'Audit type ownership and boundary placement in the compartment repo: misplaced or duplicated types, query/service leaks, root export surface, and phased move plans.'
---

# Audit Type Ownership

Use this skill for non-mutating type ownership audits in the compartment repo.

## Source of truth

- `AGENTS.md`
- `docs/layers/README.md`
- `docs/specs/type-placement.md`
- the relevant layer docs, starting with `docs/layers/api.md` when the user does not narrow the audit

## Workflow

1. Run `node .codex/skills/audit-type-ownership/scripts/audit_type_ownership.mjs` from the repo root.
2. Narrow with `--package <api|contracts|sdk|cli|edge|worker|docker|kube-runtime|utils|test-support>` when the request is scoped. Use `--format json` only when a structured artifact is more useful than Markdown.
3. Read the script output before making claims. It is a heuristic inventory, not proof.
4. Treat declared workspace dependencies as package context, not automatic findings. A non-`contracts` import matters only when it is undeclared in the owning package or it conflicts with the relevant layer doc.
5. Treat duplicate names as move candidates only when they imply a shared serialized or cross-package owner. Package-local families such as `*Input`, `*Context`, `*Plan`, `*Result`, `*Options`, `*State`, `*Config`, and `*App` can legitimately exist in multiple packages.
6. Classify findings with this matrix:

- `contracts`: serialized DTOs, public `*Request`, `*Response`, `*Summary`, shared status/value aliases
- query layer: `*Row`, `*Selection`, `*Transaction`, `*Executor`, persistence mutation inputs
- service layer: `*Input`, `*Context`, `*Plan`, `*Result`
- app/adapter layer: `*Options`, `*State`, `*Config`, `*App`

7. Treat cross-process or cross-package payloads as contract-owned, even when the current consumer is internal.
8. Treat query/service boundary leakage and placement violations from `docs/specs/type-placement.md` as ownership bugs, including generic `src/types/`, `routes/shared/`, and route DTO mappers outside `*.presenter.ts`.
9. If the audit turns into implementation, run the narrowest relevant package checks first and then add any required special checks for the diff.

## Default scope

- Start with `api`.
- Then sweep `contracts`, `sdk`, `cli`, `edge`, `worker`, `docker`, `kube-runtime`, `utils`, and `test-support`.
- Keep the audit non-mutating unless the user explicitly asks for implementation after the audit.

## Output

- `Policy`
- `Concrete findings`
- `Move list`
- `Phased refactor plan`

## Script

- `scripts/audit_type_ownership.mjs` inventories named `interface` and `type` declarations by package and file.
- It highlights duplicate type names, suspicious `@compartment/*` imports, query/service leaks, root export risks, package dependency context, and placement violations.
- Final ownership decisions still come from `AGENTS.md`, the architecture docs, and the relevant checks.
