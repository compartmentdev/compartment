# Managed-domain broker DNS-01 proof

## Decision

**PASS. Proceed with the production contract design for existing-Kubernetes
installation blockers #2 and #3.**

The proof demonstrates that cert-manager v1.21.0 can issue a wildcard
Certificate through a broker-shaped API with allocation-scoped authority, that
typed ingress targets survive the broker boundary, and that desired DNS state
can be replayed after a broker process restart. It does not demonstrate public
DNS propagation or issuance by Let's Encrypt staging.

## Scope and source contract

The proof addresses the focused dependencies from
`docs/specs/existing-kubernetes-install.md` on
`feat/existing-kubernetes-install-plan`:

- Stage 4 must preserve IPv4 as `A`, IPv6 as `AAAA`, and a load-balancer
  hostname as a hostname rather than resolving it once to unstable IPs.
- The managed-domain broker contract is reserve allocation, bind typed
  targets, authorize scoped DNS-01 records, and replay desired DNS state.
- Hard blocker #2 requires a managed wildcard to complete through the broker
  with allocation-scoped authority.
- Hard blocker #3 requires IP and hostname targets to be preserved without
  treating the shared ingress endpoint as installation-owned.

The proof preserves the existing managed-install test broker's
`installationId` plus matching `Idempotency-Key` reservation ownership shape,
Bearer-authorized `{name,value}` TXT mutations, and challtestsrv projection.
It replaces the old IP-coupled allocation response with the new four-step
contract rather than modifying production packages.

## Architecture

```text
Certificate / Issuer
        |
        | cert-manager DNS-01 Present and CleanUp
        v
proof webhook solver
        |
        | Bearer <allocation-scoped token>
        | POST/DELETE /allocations/:id/challenges
        v
proof managed-domain broker ---- persisted desired state
        |
        | NetworkPolicy-isolated proof-only DNS management
        v
Pebble challtestsrv DNS <---- CoreDNS SOA facade
        ^                           ^
        | DNS-01 validation         | cert-manager self-check
        |
      Pebble ACME CA
```

One disposable k3d cluster runs pinned k3s v1.33.2-k3s1, cert-manager
v1.21.0, the webhook, broker, CoreDNS façade, Pebble, and
`pebble-challtestsrv`. Pebble authorization reuse is disabled, so Case D must
perform a second DNS-01 authorization.

The webhook was chosen instead of an ACME-DNS façade because it maps
cert-manager's native `Present` and `CleanUp` operations directly to the new
broker challenge endpoints. This makes the allocation ID and scoped bearer
token explicit at the integration boundary.

## Contract forms exercised

1. Owner-authorized `POST /allocations` reserves `z1.proof.test` or
   `z2.proof.test` with `installationId` equal to `Idempotency-Key`, and
   returns an allocation ID plus a new scoped token. A different owner cannot
   reacquire an existing label's token.
2. `PUT /allocations/:id/targets` accepts a non-empty array of
   `{type: "A" | "AAAA" | "hostname", value: string}`.
3. `POST /allocations/:id/challenges` presents an in-zone TXT value and
   `DELETE` removes the same value. Both require the token belonging to the
   path allocation.
4. Broker startup reads persisted desired state and replays typed targets plus
   active challenges into its DNS backend.

For proof observability, the three simultaneously bound target types use
separate owners: `a.<zone>`, `aaaa.<zone>`, and `hostname.<zone>`. This avoids
the invalid DNS configuration of placing a CNAME at an owner that also has A
or AAAA records. The stored contract values remain the exact typed values
submitted by the caller.

## Case verdicts

### Case A — wildcard issuance: PASS

The harness reserved Z1, created an Issuer using Z1's allocation ID and token,
and requested `*.z1.proof.test`. cert-manager called the proof webhook, which
presented and later cleaned `_acme-challenge.z1.proof.test` through the broker.
Pebble performed three DNS validations and issued the certificate.

Evidence:

- [`case-a-certificate.yaml`](../../scripts/proofs/broker-dns01/evidence/case-a-certificate.yaml)
  records `Ready=True`.
- [`case-a-broker.json`](../../scripts/proofs/broker-dns01/evidence/case-a-broker.json)
  records `challenge_presented` and `challenge_cleaned` for Z1.
- [`case-a-txt-dig.txt`](../../scripts/proofs/broker-dns01/evidence/case-a-txt-dig.txt)
  captures the live TXT answer while the challenge is active.
- [`case-a-txt-history.json`](../../scripts/proofs/broker-dns01/evidence/case-a-txt-history.json)
  records TXT queries received by the broker-managed DNS backend.
- [`case-a-pebble.txt`](../../scripts/proofs/broker-dns01/evidence/case-a-pebble.txt)
  records three validations, a valid authorization, and certificate issuance.

### Case B — scoped authority: PASS

The direct negative request used the valid Z1 allocation URL with Z2's token
and received HTTP 403. The broker recorded
`reason=allocation_token_mismatch`, and the forbidden value was absent from
DNS. A cert-manager Issuer then used that same correct Z1 URL and wrong Z2
token for `*.forged.z1.proof.test`; its Certificate remained `Ready=False`.
The reverse cross-allocation target test used Z1's token against Z2 and also
received HTTP 403. An unauthenticated attempt to reserve Z1 under a different
installation identity received HTTP 401, preventing token reacquisition.

Evidence:

- [`case-b-direct-denial.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-direct-denial.txt)
  and
  [`case-b-target-denial.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-target-denial.txt)
  contain the broker response and HTTP 403.
- [`case-b-reservation-denial.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-reservation-denial.txt)
  contains the owner-authorization response and HTTP 401.
- [`case-b-broker.json`](../../scripts/proofs/broker-dns01/evidence/case-b-broker.json)
  records denials against the resolved Z1 and Z2 allocation IDs with the
  allocation-token-mismatch reason.
- [`case-b-certificate.yaml`](../../scripts/proofs/broker-dns01/evidence/case-b-certificate.yaml)
  records the forged certificate as `Ready=False`.
- [`case-b-challenge.json`](../../scripts/proofs/broker-dns01/evidence/case-b-challenge.json)
  records the correct Z1 allocation URL and the broker's HTTP 403
  allocation-token denial as cert-manager's `PresentError`; the live solver
  credential is removed before evidence is written.
- [`case-b-solver.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-solver.txt)
  records the webhook's successful Z1 presentation and cleanup control path.
- [`case-b-txt-dig.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-txt-dig.txt)
  and
  [`case-b-forged-txt-dig.txt`](../../scripts/proofs/broker-dns01/evidence/case-b-forged-txt-dig.txt)
  record zero-answer DNS responses: neither forbidden TXT value appeared.

This case cannot pass because of an incorrect URL: the broker's audit entry
names the existing Z1 allocation and explicitly identifies a token mismatch.

### Case C — typed targets: PASS

One bind request submitted A `1.2.3.4`, AAAA `2001:db8::1`, and hostname
`lb.example.com`. The state observation preserves those types and values.
Direct proof-DNS queries return A, AAAA, and CNAME respectively. Separate A
and AAAA queries for the hostname owner return only the CNAME and no terminal
IP answer, so a resolver cannot conceal one-shot hostname resolution.

Evidence:

- [`case-c-broker.json`](../../scripts/proofs/broker-dns01/evidence/case-c-broker.json)
  contains the exact typed desired state.
- [`case-c-a.txt`](../../scripts/proofs/broker-dns01/evidence/case-c-a.txt),
  [`case-c-aaaa.txt`](../../scripts/proofs/broker-dns01/evidence/case-c-aaaa.txt),
  and
  [`case-c-cname.txt`](../../scripts/proofs/broker-dns01/evidence/case-c-cname.txt)
  are direct `dig` answers from the proof DNS port.
- [`case-c-hostname-a.txt`](../../scripts/proofs/broker-dns01/evidence/case-c-hostname-a.txt)
  and
  [`case-c-hostname-aaaa.txt`](../../scripts/proofs/broker-dns01/evidence/case-c-hostname-aaaa.txt)
  show CNAME-only answers to IP-type queries.

### Case D — replay and repeated order: PASS

The harness added an active replay challenge, confirmed it in DNS, cleared the
DNS backend without changing desired state, and requested a broker process
restart. It required the Kubernetes container restart count to increase before
continuing. Startup replay restored the active TXT plus A, AAAA, and CNAME
answers. A second Certificate for `*.z1.proof.test` then completed a fresh
Order and DNS-01 validation with Pebble authorization reuse set to zero.

Evidence:

- [`case-d-before.txt`](../../scripts/proofs/broker-dns01/evidence/case-d-before.txt)
  and
  [`case-d-after.txt`](../../scripts/proofs/broker-dns01/evidence/case-d-after.txt)
  contain the same active TXT before backend clearing and after process
  restart.
- [`case-d-broker.json`](../../scripts/proofs/broker-dns01/evidence/case-d-broker.json)
  records `replayCount=2`, a startup replay with three targets and one active
  challenge, and a second cert-manager challenge presentation and cleanup.
- [`case-d-certificate.yaml`](../../scripts/proofs/broker-dns01/evidence/case-d-certificate.yaml)
  records the repeated Certificate as `Ready=True`.
- [`case-d-pebble.txt`](../../scripts/proofs/broker-dns01/evidence/case-d-pebble.txt)
  records authorization reuse at 0%, two validation sequences, two valid
  authorizations, and two issued certificates.

## Production implications

The following shapes should carry into the production broker:

- reservation and target binding are separate idempotent operations;
- the allocation ID is the sole authority scope and is checked against the
  bearer credential on every target and challenge mutation;
- challenge names are independently constrained to
  `_acme-challenge.*.<allocation-zone>`;
- challenge cleanup identifies the exact TXT value so concurrent values can
  be handled safely;
- typed target values remain typed desired state, especially hostnames;
- replay is driven from durable desired state, not reconstructed from the DNS
  provider;
- the broker never receives certificate private keys and never owns or mutates
  the shared ingress endpoint itself.

Production credentials must be stored in Kubernetes Secrets and read by the
solver with narrowly scoped RBAC. The proof embeds ephemeral tokens in Issuer
configuration only to make the security boundary inspectable.

## Proof limitations

- Pebble is an ACME protocol test CA, not Let's Encrypt staging. A live staging
  run is still required to establish public delegation, recursive propagation,
  CA reachability, rate-limit behavior, and the production trust chain.
- `pebble-challtestsrv` plus CoreDNS is a proof-only authoritative DNS backend.
  It does not test a production provider API, provider consistency, DNSSEC,
  multi-region replay, or provider outage recovery.
- Broker state uses a file on a container-lifetime volume. The restart case
  proves process replay, not durable database replication or recovery after
  volume loss.
- Proof mutations are not crash-transactional: DNS is changed before the
  desired-state file is committed, challenges have no expiry, and a crash
  between those actions could orphan or resurrect a TXT record. Production
  requires transactional intent, reconciliation, and stale-challenge expiry.
- The webhook is proof-grade: it has no Secret lookup, token rotation,
  metrics, retry policy, network policy, release packaging, or multi-tenant
  operational hardening.
- Target owners are proof-specific observability names. Production record
  layout for console and application hosts remains an implementation decision.
- The harness proves that binding stores endpoint references and performs no
  load-balancer mutation. It does not emulate a cloud provider's shared load
  balancer ownership controls.

## Blocker verdicts

- **Hard blocker #2: GO.** cert-manager v1.21.0 completed two wildcard
  DNS-01 orders through the broker, and cross-allocation authority was denied
  on both direct and cert-manager-driven paths.
- **Hard blocker #3: GO for contract implementation.** A, AAAA, and hostname
  targets survived binding, DNS projection, process replay, and a repeated
  order without resolving the hostname to IPs or mutating an ingress endpoint.
  Production implementation must retain the same reference-only ownership
  rule and validate it against a real shared ingress controller.

The proof supports implementation work. It does not authorize production
rollout until the limitations above, especially a Let's Encrypt staging run
and durable broker storage, are resolved in their owning implementation and
acceptance stages.
