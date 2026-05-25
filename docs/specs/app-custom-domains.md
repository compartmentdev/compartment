# App Custom Domains

App custom domains are exact-host aliases for an existing public app route. This document keeps the durable behavior: what custom domains add, what they depend on, and which packages own each concern.

## Scope

- Adds one or more exact custom hosts to an already active public route owner.
- Keeps the install `baseDomain` host family as the canonical fallback.
- Does not replace canonical hosts, broker-managed install domains, or whole-install domain operations.

## Core decisions

- A custom domain is an alias to an existing route owner, not a new routing primitive.
- Verification has two separate durable dimensions: domain ownership and runtime routing.
- A host is serveable only after both dimensions are valid.
- Certificate issuance for app custom domains stays local to the customer host and is separate from install wildcard certificate management.

## Runtime and DNS boundaries

- Managed install domains support custom domains only when routing resolves directly to the install ingress.
- Custom-cert installs support custom domains by targeting the canonical route host family.
- External-TLS HTTP-origin installs do not support app custom domains in this version because the install cannot terminate TLS for those hosts itself.
- Custom domains must stay outside the active install `baseDomain` namespace.

## Ownership

- `contracts` owns public DTOs, schemas, protocol identifiers, and edge snapshot contract shape.
- `api` owns persistence, verification state, host validation, collision checks, browser-flow target validation, and edge-state projection.
- `sdk` owns typed access to the public custom-domain API surface.
- `cli` owns operator UX, target resolution, and DNS guidance rendering.
- `edge` owns host-keyed active state and the allow-list gate for on-demand TLS issuance.
- The broker does not participate in per-app custom-domain lifecycle or certificate issuance.

## Invariants

- Every custom host is globally unique and bound to one stable route owner.
- Verification state is durable and must survive retries; failed checks require operator correction, not silent activation.
- Only verified custom hosts may enter active edge state or the on-demand TLS allow-list.
- Browser flows may start on canonical or verified custom hosts, but redirects and logout targets must stay within validated active hosts.
- Session isolation stays host-based; custom domains do not share host cookies with canonical hosts by default.

## Rationale

- Separating ownership from routing verification keeps DNS authority proof distinct from traffic-destination proof.
- Using exact-host local ACME issuance avoids moving customer DNS or certificate custody into the broker.
- Keeping edge state host-keyed lets the system authorize serving and certificate issuance from one verified source of truth.

## Non-goals

- Wildcard customer domains.
- Customer-uploaded app certificates.
- Pre-provisioning before the first active deployment for a service.
- App custom domains for external-TLS HTTP-origin installs.
- Broker-managed customer DNS or broker-side per-app host control.
