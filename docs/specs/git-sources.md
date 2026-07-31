# Git Sources

Status: proposed
Updated: 2026-04-30

## Decision

Git is an optional source kind.
It does not replace local source upload, and it does not change the existing deploy, release, promote, or rollback pipeline after source resolution.

## Coexistence Model

- The platform remains headless and CLI-first.
- `local-upload` and `git` are parallel source kinds that both normalize into the same worker-local source snapshot contract.
- A project may keep using local deploy after a Git source is connected.
- Deployment history should preserve which source kind produced each deployment.
- The latest successful deployment still wins active state regardless of source kind.

## Project Identity

- `compartment.yml` remains the canonical app identity surface.
- The descriptor `name` remains the canonical project slug.
- One binding maps one discovered descriptor to one stable `project_id`.
- Git-triggered deploys must target that bound `project_id`, not re-resolve by slug on every push.

## Ownership Split

Source owns:

- repository identity and provider linkage;
- integration health and webhook state;
- source-level defaults for future adoption;
- descriptor-path exclusions.

Binding owns:

- one descriptor path;
- one bound project;
- branch mapping;
- auto-deploy policy;
- extra watch paths for shared inputs.

This split keeps repository transport settings separate from app-specific deploy behavior.

## Discovery And Adoption

- `connect git` registers or reuses one source, then relies on remote sync for descriptor discovery.
- Discovery always comes from the configured remote sync branch, not from the caller's local checkout state.
- Auto-adopt uses one API-owned path reused by bootstrap connect, manual sync, and sync-branch pushes.
- Repositories with zero current descriptors are valid sources.
- A disconnected binding may be reactivated at a moved descriptor path only when the old descriptor path is absent and the discovered project name matches one disconnected binding unambiguously.

## Exclusion Policy

- Exclusions are source-owned and keyed by canonical descriptor path.
- Exclusions always win over auto-adopt.
- Excluding a path disconnects any active binding and prevents later sync runs from recreating it implicitly.
- Including a path re-enters the normal sync and adoption pipeline rather than creating a binding directly.

## Branch And Change Model

- Branch mapping lives on the binding, not on the source.
- v1 supports exact branch names only.
- A push can trigger auto-deploy only for active sources, active bindings, enabled auto-deploy, a matching branch mapping, and matching watch-scope changes.
- If the provider cannot supply a trustworthy changed-file list, the system must conservatively treat all branch-matched bindings as affected.

## Authorization Boundary

- Source list, show, and sync require at least organization `deployer`.
- `connect git` and disconnect require organization `admin`.
- Install-owned provider bootstrap and shared registration use the same organization `admin`/`source.manage` surface as `connect git`; registration requests must still match the selected provider host and repository owner.
- Git-triggered deploys run through an org-scoped non-human automation principal, not by bypassing normal auth.

## Provider Model

- v1 prefers install-scoped GitHub App registrations for GitHub and supported GHES hosts.
- v1 also supports token-based GitLab registrations for gitlab.com and trusted self-managed GitLab hosts. A registration stores the provider host and token-backed credential, is organization-scoped for selection, and is rotated in place when the same host/owner is connected again.
- Managed-domain installs may use the broker only as a stateless short-lived GitHub OAuth helper, authorized by the existing managed-domain token, to list the user's account and organization choices before install-owned app bootstrap. That helper must not request repo scopes, store GitHub OAuth tokens or account lists, or proxy repository operations.
- Source creation must verify that the selected repository is accessible through the active install-owned GitHub App registration before source creation.
- Git auto-deploy requires a public HTTPS callback and webhook surface for the install.

## Resolution Boundary

- Worker owns exact-SHA fetch, descriptor read, snapshot normalization, and archive upload.
- API owns source matching, task persistence, temporary archive lifecycle, binding checks, and deployment queueing.
- The normalized snapshot must stay compatible with the existing source-archive contract.

## Promote And Rollback

- Git affects only initial source acquisition.
- Promote and rollback must continue using stored build artifacts and image references.
- They must not require later Git availability.

## Non-Goals

- replacing local deploy;
- making browser UI the source of truth;
- storing runtime variables in Git providers;
- preview environments or PR deploys in v1;
- manual webhook or repo-credential fallback;
- post-connect branch-mapping or watch-path editing flows in v1.
