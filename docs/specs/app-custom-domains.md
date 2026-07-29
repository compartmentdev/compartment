# Application custom domains

Application custom domains use the shared Kubernetes ingress and cert-manager contract.

## Ownership

- The API owns requested, pending, verified, active, and removing domain state.
- The worker reconciles DNS verification and Certificate readiness.
- The edge accepts only active, host-keyed routes and preserves the application authorization boundary.
- The selected Ingress Controller owns public listeners and TLS termination.
- cert-manager owns Certificate issuance through the configured Issuer or ClusterIssuer.

## Routing

Managed installs route custom domains directly to the retained typed public ingress targets. Issuer-backed installs
use a CNAME to the canonical application route for subdomains and the DNS provider's supported alias or flattening
record to that same route for apex domains. Compartment never creates a hostless rule, controller-specific annotation,
or separate public Service.

Only verified domains become active. Deletion removes the active route first, then finalizes state after the ingress
projection no longer contains the host.

## Certificates

Certificate resources contain the exact custom host and reference the installation's configured issuer. Compartment
does not accept certificate files, create operator certificate Secrets, or mount certificate material into API,
edge, or Caddy workloads.

## Security

- DNS ownership verification is required before activation.
- Exact active-host state gates public routing.
- Internal, health, operator, registry, and build endpoints remain outside public ingress.
- Project NetworkPolicy and project-scoped image pull Secret projections remain unchanged.
