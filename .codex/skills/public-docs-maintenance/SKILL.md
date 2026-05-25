---
name: public-docs-maintenance
description: Maintain the public Starlight docs site for material changes to shipped Compartment workflows, using generated reference where possible and concise task- and decision-focused guides elsewhere.
---

# Public Docs Maintenance

Use this skill when work touches `public-docs/` or materially changes shipped user workflows, public contracts, or operator decisions.

## Source of truth

- `AGENTS.md`
- `public-docs/`
- `scripts/docs/public-docs/public-docs-map.mjs`
- generated reference inputs from `packages/cli/src/commands/**` and `packages/contracts/src/contracts/**`
- current-state engineering docs under `docs/` only as implementation context, not as publishable copy

## Public docs intent

- The public site is for Compartment users and operators, not repo contributors.
- Public docs explain commands, configuration choices, externally visible behavior, limits, and user responsibilities.
- Engineering docs, architecture docs, runtime topology, proposal specs, and review follow-ups stay outside the public site.

## Docs threshold

- Do not document every user-visible change.
- Update public docs only when users must change what they do, understand a public contract, make a configuration/security/compatibility decision, or account for externally visible lifecycle behavior.
- Public contract and generated-reference inputs still count; regenerate reference without adding prose when that is enough.
- Example: a checkbox default changing does not need a docs paragraph unless it changes setup steps, permissions, security, compatibility, or another operator decision.

## What to include

- Style preferences:
  - write directly and concretely;
  - use active voice and second person when it helps;
  - prefer current commands, current file names, and observable outcomes over implementation mechanics;
  - avoid hype, filler, and generic “why this matters” padding.
- Code standards:
  - prefer real `compartment` CLI commands;
  - prefer minimal valid YAML for `compartment.yml` and `compartment.routes.yml`;
  - do not use `foo`, `bar`, or placeholder hostnames when a concrete example is clearer.
- Content requirements:
  - guides should usually include purpose, main steps, important constraints, externally visible automation, and next steps;
  - major shipped features usually need an updated overview plus at least one task guide;
  - generated reference or a small overview edit is not enough when users need a new workflow, public concept, or mental model;
  - reference pages should stay generated when the source is deterministic;
  - for curated docs pages, the last URL path segment should match the page title in a predictable normalized form;
  - CLI reference pages are the exception: when the title would create duplicate last path segments, add the smallest useful unique path part instead of forcing identical slugs;
  - do not duplicate generated reference content in long hand-written pages when a short explanation plus a reference link is enough;
  - describe background behavior by its user-visible effect, schedule, retention, expiry, limits, or required action; do not describe libraries, queues, database tables, process boundaries, or service topology unless those details change an installation or incident-response decision.
- Product context:
  - Compartment is CLI-first;
  - installs, orgs, projects, environments, services, deployments, domains, variables, and access are the canonical public nouns;
  - internal docs under `docs/specs/*` may mix shipped decisions and future proposals; do not describe behavior as shipped unless current code or existing public docs confirm it.

## Workflow

1. Identify whether the change materially affects workflows, public contracts, generated reference inputs, or operator decisions. Otherwise, leave public docs alone.
2. Decide whether the source belongs in generated reference, curated guides, or both.
3. Regenerate reference output first when the source is deterministic.
4. Update the smallest correct curated pages next.
5. Keep public pages short, task-shaped, and focused on user actions or operator decisions.
6. Link from guides to generated reference instead of repeating long option inventories.
7. If a page title or URL changes, search the public docs for references to the old title or path and update them.
8. Before finishing, run `pnpm docs:generate` when generated reference is in scope and `pnpm docs:check` before handing off a public-docs change.

## Guardrails

- Do not publish `docs/layers/**`, `docs/specs/**`, or `review-follow-ups.md` through the public site.
- Do not expose internal-only routes, internal tokens, or engineering-only runtime mechanisms. Publish only the observable behavior, configuration knobs, commands, limits, failure modes, and responsibilities that users need.
- Do not claim behavior is available unless it is shipped in the current codebase.
- Do not hand-edit files under `public-docs/src/content/docs/reference/generated/` when the underlying generator should own them.
