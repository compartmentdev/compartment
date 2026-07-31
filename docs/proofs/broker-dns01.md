# Managed-domain broker DNS-01 proof

## Current production contract

Kubernetes uses the same broker contract as the main installation path:

1. The CLI sends one unauthenticated `POST /v1/managed-domains` with
   `installationId`, `publicIp`, `requestedLabelSource`, and optional runtime
   metadata.
2. The broker returns `baseDomain` and `acmeDnsToken` and publishes A or AAAA
   records for the supplied IP address.
3. The cert-manager webhook sends `PUT` to
   `/v1/managed-domains/acme-dns/txt` to present a TXT value and `DELETE` to
   the same path to clean it up. Both requests contain `{name,value}`, use
   `Authorization: Bearer <acmeDnsToken>`, and require HTTP 204 with no body.

The Kubernetes topology still uses cert-manager and the webhook solver because
Caddy sits behind the shared Ingress and does not own ACME.

## Endpoint constraint

The production broker publishes only A and AAAA records. A managed-domain
installation therefore requires an IPv4 or IPv6 Ingress endpoint. A hostname
endpoint is rejected before expensive installation work when configured
explicitly, or immediately after Ingress discovery otherwise. The installer
does not resolve the hostname to an IP because cloud load-balancer addresses
can change; operators must use their own domain through `--base-domain`.

## Historical proof artifacts

The files under `scripts/proofs/broker-dns01/` are historical artifacts from a
superseded experimental broker model. They are retained only as evidence of
the cert-manager webhook feasibility study and must not be run or used as a
production contract reference. Current executable coverage lives in the Go
solver tests and the `managed-install` end-to-end shard.
