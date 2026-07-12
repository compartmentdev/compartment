# P5 Kubernetes Secrets and RBAC Report

## Result

Effective deployment variables project to one deterministic Secret. Sensitive
and non-sensitive variables follow the same path. Deployment and Job pod
environment types accept only `secretKeyRef`; the Secret data checksum on the
pod template triggers rollout when and only when the data changes.

Project provisioning uses a bootstrap-configured `KubeRuntime`. Its ordered
`apply` bundle creates the immutable-ID namespace, tokenless controller service
account, and namespace-local controller RoleBinding. A separate installation
identity deletes the temporary bootstrap ClusterRoleBinding in `finally`,
including after partial failure. Existing-object conflicts remain retryable.
This keeps the four-method runtime boundary and does not add another Kubernetes
write path.

The bootstrap identity cannot recreate its own binding. Installation authority
must establish a fresh short-lived binding before each later project
provisioning run; cleanup makes a second run fail closed until that happens.

## Inventory and LOC

| Surface             | Baseline | P5 total | Delta | D33 headroom |
| ------------------- | -------: | -------: | ----: | -----------: |
| Production runtime  |    1,114 |    1,475 |  +361 |        1,525 |
| Tests and harnesses |      731 |    1,054 |  +323 |          n/a |

Counts are physical lines in `packages/kube-runtime/src/**/*.ts` and
`packages/kube-runtime/test/**/*.ts`. Manifests, snapshots, and docs are
excluded. Production remains below the 3,000-line package budget.

## Library check

No dependency was added. Node's existing `crypto` hash implementation,
`@kubernetes/client-node` object API, and the package's existing test-only YAML
parser cover checksum, apply/delete, and manifest contract needs.

## Coordination made unnecessary

The runtime contract no longer transports plaintext variable values into pod
manifests. One Secret projection, deterministic key ordering, `secretKeyRef`,
and the data checksum form the canonical handoff.

## RBAC rollout decision

No existing or seeded Compartment principal or group receives bootstrap or
controller authority. Fresh installs explicitly create a short-lived bootstrap
binding, delete it after namespace provisioning, and create one namespace-local
controller binding per managed project. Existing projects require explicit
backfill or opt-in. These are Kubernetes installation permissions, not
Compartment user permissions.

## Delete list

P5 is additive. Docker runtime environment injection remains unchanged. The
legacy env-plaintext path is removed at the atomic integration cutover, with no
compatibility fallback retained.
