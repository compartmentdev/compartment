# P6 Kubernetes NetworkPolicy Report

## Result

Project namespace provisioning now applies one deterministic NetworkPolicy set
after the namespace, tokenless controller service account, and RoleBinding are
created. The set contains namespace-wide default-deny ingress and egress,
application egress, edge-to-application ingress, and application-to-resource
ingress. It uses the existing server-side apply path and adds no runtime
primitive.

Application egress allows same-namespace resource traffic and kube-dns/CoreDNS.
The external `0.0.0.0/0` rule excludes metadata
`169.254.169.254/32`, all link-local traffic, and the configured Pod and Service
CIDRs. The Kubernetes API Service remains the T2 limit because supported CNIs
evaluate Service traffic after DNAT. P5's
`automountServiceAccountToken: false` is the mitigation; P6 does not claim a
NetworkPolicy deny that Kubernetes cannot enforce.

## Inventory and LOC

| Surface             | P5 baseline | P6 total | Delta | D33 headroom |
| ------------------- | ----------: | -------: | ----: | -----------: |
| Production runtime  |       1,537 |    1,595 |   +58 |        1,405 |
| Tests and harnesses |       1,124 |    1,244 |  +120 |          n/a |

Counts are physical lines in `packages/kube-runtime/src/**/*.ts` and test
TypeScript respectively. The live-cluster shell harness, snapshots, manifests,
and docs are excluded. Production remains below the 3,000-line package budget.

No dependency was added. Projection uses the existing Kubernetes manifest
types and server-side apply bundle. Golden YAML serialization remains test-only.

## Validation and rollout

Manifest contract tests lock policy and bundle order, selectors, ports, DNS,
and CIDR exclusions. They prove the broad external rule does not reopen project,
platform, metadata, Pod-CIDR, or Service-CIDR traffic while explicit resource,
edge, and DNS paths remain present. The permanent
`network-policy-enforcement-check.sh` harness is negative-first: it proves a
connection succeeds before applying deny policy, then polls until the same
connection is blocked. Run it only against an enforcing CNI such as k3d with
kube-router or Calico; kind's default CNI is not evidence of enforcement.

This adds no Compartment permission or default grant. Fresh namespace
reconciliation applies the policy set. Existing projects require explicit
reconciliation or backfill.

## Delete list

P6 is additive. The atomic Kubernetes cutover removes the legacy
`docker-network-egress*` surface, `docker-firewall-backend` surface, and node
`runtime-network-egress` service together with their tests, exports, callers,
and scaffolding. This change does not edit or retain a compatibility fallback
through those paths.
