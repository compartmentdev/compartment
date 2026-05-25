# Managed Platform Domains

Managed platform domains cover install-level public domain ownership for the whole install. This document keeps only the durable contract: who owns which part, what must remain true, and what this model intentionally does not do.

## Scope

- Covers the install `baseDomain`, the control-plane host under that domain, and whole-install staging, verification, activation, and reset for system domains.
- Does not cover per-app custom domains. Those are separate aliases on top of an existing app route and do not change install-level allocation state.

## Core decisions

- The install still has exactly one active `baseDomain`.
- Managed-domain mode changes only how that `baseDomain` is allocated; it does not change browser traffic termination, which stays on the customer host.
- In the managed-domain path, the broker allocates the install domain and owns DNS writes for that broker-owned zone.
- Certificate private keys stay on the customer host. The broker stores only the scoped ACME DNS credential material needed to authorize TXT updates.
- The broker stores allocation metadata for managed-domain installs: installation id, public ingress IP, generated base domain,
  selected runtime version, CLI version, and OS platform details.

## Ownership and boundaries

- The broker is the source of truth for managed-domain allocation state; provider DNS is derived state.
- The broker owns allocation, DNS record mutation inside its zone, token scoping, and recovery from provider drift by replaying its own state.
- The install owns local runtime configuration, local certificate issuance and renewal, and whole-install domain activation against the active runtime.
- Pending whole-install custom-domain setup state belongs to the API and represents staged verification/activation data only. The active domain remains runtime-owned.
- CLI commands orchestrate local runtime and protected API flows but do not write setup state directly.

## Invariants

- Managed-domain installs keep one wildcard-backed host family under the active `baseDomain`.
- DNS authority stays with the broker-owned parent zone; installs do not receive direct provider credentials for that zone.
- Managed allocation uses a broker-generated label, not an exact vanity reservation from operator input.
- ACME DNS access is limited to the install's challenge record and must reject writes outside that scope.
- Whole-install custom-domain activation requires proof of domain ownership and proof that traffic resolves directly to this install's public ingress.
- Managed domains are immutable for the lifetime of that allocation. Public-IP changes are handled by a fresh allocation rather than in-place resync.

## Rationale

- Keeping broker state authoritative makes DNS recreation possible without depending on provider-specific record identifiers.
- Keeping certificate issuance on the customer host preserves direct browser-to-install traffic and avoids central certificate custody.
- Requiring direct ingress proof for whole-install custom domains avoids accepting CDN or proxy answers that do not prove traffic lands on this install.

## Non-goals and rollout assumptions

- No per-install delegated child zones or install-side ownership of the broker zone.
- No broker custody of install certificates or private keys.
- No in-place mutation of an existing managed allocation when ingress IPs change.
- Per-app custom-domain flows remain install-local and do not alter broker-managed install allocation state.
