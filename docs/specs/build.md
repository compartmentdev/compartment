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
- Build values are mounted as Railpack secrets and participate in cache identity only through a tenant-keyed fingerprint. Dockerfile builds reject `build.env` because Docker build arguments would expose values in process arguments and image metadata.
- `build.packages` is the public surface for Railpack system packages and is split by `build` and `runtime`.
- Runtime-start override is a separate runtime concern and is valid only on build paths that explicitly support it. In the current model, `run.command` is a Railpack-only capability.

## Strategy Boundaries

- `dockerfile` owns the image contract when the repo needs explicit container control.
- `railpack` owns source builds, optional build-command override, and system-package installation.
- `build.command` and `build.packages` are valid only for Railpack-owned builds.
- Build-time variable exposure reuses the runtime-variable store and stays explicit through `build.env`; v1 does not add a second build-secret product surface.
- Docker build context overrides, public build args, cache tuning, and prebuilt-image deploys are out of scope for v1.

## Artifact identity

- Source identity is a versioned logical digest over normalized paths, entry types, executable modes, and file contents; archive ordering and compression timestamps do not affect it.
- Artifact identity scopes that source digest to the organization, project, service, target platform, canonical resolved build configuration, tenant-keyed build-value fingerprints, and the pinned builder profile.
- One database fingerprint owns a build. Ready retained matches reuse the immutable registry digest without a BuildKit Job, while concurrent matches join the same owner.
- Railpack frontend, builder, and runtime images are digest-pinned. The registry cache is project/service scoped and remains an internal implementation detail.
- Each installation supplies a builder-profile digest for its linux/amd64 profile. The Helm chart derives it from the pinned worker and BuildKit images plus the platform, sandbox, and snapshotter configuration; local development supplies the matching explicit value. Change the digest whenever any profile input changes.
- A new image becomes reusable only after its digest-bound Syft SBOM has been stored. Reuse does not scan again.
- Artifacts created before SBOM-backed readiness remain non-ready after migration. Their next retained deployment rebuilds from the retained source archive, stores current SBOM evidence, and only then becomes reusable.

## Non-Goals

- No separate `compartment build` command in v1.
- No user-facing artifact registry or artifact lifecycle surface in v1.
- No repo-authored secret values or `.env` files for build inputs.
- No post-build mutation of compile-time inputs.
