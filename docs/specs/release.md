# Application Release Spec

Status: shipped
Updated: 2026-07-15

This document captures the intended release-step contract for services in `compartment.yml`. The release step is a service-local deploy stage that runs after build and before candidate start.

## Decision

The canonical public noun is `release`.

- `release.command` is the single repo-authored release surface in v1.
- Release is distinct from both build and long-running runtime start.
- There is no separate top-level release workflow in v1.

## Contract

- `release` is optional and service-local.
- Shorthand service form stays valid only for services without `release`.
- A service with `release` must use object form in `compartment.yml`.
- `compartment deploy` remains the only public entrypoint; release is reported as a deploy stage.

## Execution Invariants

- Release runs from the already built image.
- Release executes as a Kubernetes Job in the target project namespace, not in the image-build environment.
- The release container receives the same effective runtime variables as the target service.
- Release runs once per deploy attempt, before candidate start and before route switching.
- Promote, rollback, and start reuse an existing image and do not rerun release.
- Any non-zero exit or timeout fails the deploy.
- Re-running release requires a fresh deploy; v1 has no automatic retry.

## Ownership And Boundaries

- Worker owns image build orchestration, release-Job execution, and deployment reconciliation.
- `kube-runtime` owns the Job and application workload writes.
- Release is runtime-targeted by design because common use cases need runtime connectivity such as `DATABASE_URL`.
- Build-host hooks, project-wide release hooks, repo-authored timeout tuning, and long-running release sidecars are out of scope for v1.

## Non-Goals

- No separate `compartment release` command in v1.
- No project-wide or deploy-wide release block in v1.
- No automatic retries in v1.
- No repo-authored timeout fields in `compartment.yml`.
