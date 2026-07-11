# P1 Kubernetes Runtime Report

## Result

P1 establishes `@compartment/kube-runtime` as the sole Kubernetes write owner.
The package exposes four side-effecting methods: `apply`, `observe`, `logs`,
and `runJob`. Naming, projections, and state decisions are pure functions.

The durable migration decisions are canonicalized in
`docs/specs/k8s-runtime.md`; package ownership is in
`docs/layers/kube-runtime.md`.

## Inventory and LOC

The accepted pre-change baseline remains 23 API/worker files and 2,029 lines,
listed in `docs/reports/k8s-runtime-inventory.md`.

| Surface                           | Production | Test/harness |
| --------------------------------- | ---------: | -----------: |
| `packages/kube-runtime`           |      1,046 |          633 |
| API schema and transition queries |        209 |          248 |

The package runtime is 1,954 lines below the D33 limit of 3,000. Generated
migration SQL, snapshots, manifests, docs, and configuration are not runtime
source. The test/harness column is reported separately and is not charged to
the runtime budget.

Reproduce the physical-line counts (blank lines and comments included):

```sh
find packages/kube-runtime/src -name '*.ts' -print0 | xargs -0 wc -l
find packages/kube-runtime/test -name '*.ts' -print0 | xargs -0 wc -l
wc -l packages/api/src/db/schema-kube-runtime*.ts \
  packages/api/src/queries/deployment-kube-reference.query*.ts
wc -l packages/api/test/deployment-kube-reference.query.db.test.ts
```

P1 is additive, so the G1 60% deletion metric is not claimed yet. The baseline
denominator stays fixed for the integration cutover.

## Coordination removed or made unnecessary

The controller no longer needs a read-before-write diff coordinator, a raw
watch reconnect loop, mutable-name lookup, or separate state and drift-audit
writes. SSA owns declared fields; immutable IDs make retries idempotent;
label-scoped informer caches own observation; and a row lock plus monotonic
revision in one database transaction serializes transition and audit
persistence.

## RBAC rollout decision

No Compartment permission or seeded principal changes. P1 ships the bootstrap
and controller RBAC artifacts. H1 must wire fresh installs to create the
bootstrap identity only for project namespace provisioning, remove its binding
immediately, and create one namespace-local controller binding. Existing
projects require explicit backfill or opt-in.

## Delete list

P1 intentionally preserves these legacy surfaces until the atomic integration
cutover:

- `nodes` and node registration/runtime requester paths;
- `deployments.nodeId`, `containerId`, `drainingContainerId`, and `drainingNodeId`;
- `deployments.upstreamHost` and `upstreamPort`;
- Docker runtime deployment, release, and network-reservation coordination;
- repository registration for the removed node and Docker-engine surfaces:
  commitlint scopes, both Knip configs, CI package rows, layer index/docs, and
  every `.codex/skills` package or ownership list.

These items are deleted vertically in the integration branch before its
single cutover merge to `main`; deregistration is part of the G1 grep gate and
no fallback path is retained.

## Validation scope

Permanent package coverage includes application and Secret YAML goldens, all
four T9 kill points, concurrent informer callback replay, informer disconnect
restart/stop behavior, desired/pending/active decisions, and immutable-ID name
collision protection. API database coverage proves concurrent callback
serialization, single drift audit, and transaction rollback on audit failure.

P10 end-to-end coverage is intentionally unchanged.
