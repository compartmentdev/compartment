# Application Build Spec

This document keeps only the durable build decisions behind the repo-authored service model in `compartment.yml`. Exact current validation rules belong in contracts and generated reference.

## Decision

The canonical public noun is `build`.

- `build` describes how a service becomes a runnable image.
- `run` remains an adjacent runtime-start surface, not a second build abstraction.
- `artifact` remains an internal implementation term, not a user-facing config concept in v1.

## Contract

- Build configuration is service-local and repo-authored in `compartment.yml`.
- `services.<name>: <path>` remains valid shorthand for path-only services.
- Object form is required when a service defines `build`, `run`, or `readiness`.
- Omitting `build` still means the service builds by convention.
- The default strategy is `auto`: use `Dockerfile` when present in the service directory, otherwise use Railpack.

## Invariants

- `service.path` is the owning working directory for the service.
- `build.include` may widen source input, but it must stay inside the repo or worktree boundary.
- For non-Dockerfile source builds, a widened source input is prepared from the widened context root. Railpack package-manager detection and dependency installation must use that context root; `service.path` remains the service identity, not the Railpack app root.
- `build.env` is an allow-list of variable names exposed at build time; build access is never implicit.
- `build.packages` is the public surface for Railpack system packages and is split by `build` and `runtime`.
- Runtime-start override is a separate runtime concern and is valid only on build paths that explicitly support it. In the current model, `run.command` is a Railpack-only capability.

## Strategy Boundaries

- `dockerfile` owns the image contract when the repo needs explicit container control.
- `railpack` owns source builds, optional build-command override, and system-package installation.
- `build.command` and `build.packages` are valid only for Railpack-owned builds.
- Build-time variable exposure reuses the runtime-variable store and stays explicit through `build.env`; v1 does not add a second build-secret product surface.
- Docker build context overrides, public build args, cache tuning, and prebuilt-image deploys are out of scope for v1.

## Non-Goals

- No separate `compartment build` command in v1.
- No user-facing artifact registry or artifact lifecycle surface in v1.
- No repo-authored secret values or `.env` files for build inputs.
- No post-build mutation of compile-time inputs.
