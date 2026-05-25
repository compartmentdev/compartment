# System Architecture

This document keeps only durable architecture rules. For current components, routes, and command surfaces, read code or generated references.

## Runtime Model

- The platform is split into a control plane, a runtime executor, and a public ingress boundary.
- Public ingress is intentionally narrow: control-plane traffic stays on the console host, and hosted-app traffic is mediated by the edge boundary before proxying to runtime services.
- Runtime service networks are private and service-scoped. Private runtime-to-runtime connectivity is not a product contract.
- The persisted model already separates node registration and environment placement from deployment submission. Single-host operation is common, but the architecture must not assume that as a permanent contract.

## Auth And Access

- Authentication uses server-side session state, not self-contained bearer tokens.
- Organization context is part of the auth model: login method availability, memberships, and roles are organization-scoped concerns.
- Hosted-app authorization is enforced at the edge boundary, not by trusting application runtimes to implement platform access rules.
- Route access mode is part of the hosted-app contract. Identity headers are emitted only for authenticated hosted-app access.
- Public auth completion flows need abuse protection. Throttling and cooldown decisions belong to the platform boundary, not to individual apps.

## Deployment Contract

- Repo-authored deploy input is the descriptor pair: required `compartment.yml` and optional `compartment.routes.yml`.
- Deployments are source-submission plus validation plus queued execution. The API validates descriptors and build intent before workers execute.
- Built artifacts are immutable deployment inputs after build. Promotion and rollback reuse stored artifacts instead of rebuilding source.
- Deployment-owned runtime decisions must be snapshotted at queue time so later promote or rollback operations remain reproducible.

## Ingress And Host Boundaries

- Public ingress exposes only documented control-plane paths on the console host.
- Internal routes, health endpoints, and control-plane internals must never be exposed through public ingress.
- Hosted route hosts are canonical and derived, not user-authored arbitrary public hosts.
- Edge chooses the destination and trusted proxy headers; Caddy remains transport-focused and must not become a second policy engine.

## Non-Goals

- Cross-service Docker DNS as a user-facing contract.
- Direct public exposure of internal resources or control-plane internals.
- Rebuilding source as part of promote or rollback flows.
