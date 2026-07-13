# Kubernetes Runtime

Status: migration decision
Updated: 2026-07-12

## Ownership

`@compartment/kube-runtime` is the only package allowed to write workload
objects to Kubernetes. It replaces `packages/node`; Kubernetes is the only
runtime target and there is no generic multi-orchestrator abstraction (D9).

The database owns desired state, configuration, versions, history, and audit.
Kubernetes owns live state. API owns persistence and transactions, worker owns
asynchronous deployment orchestration, and `kube-runtime` owns Kubernetes
transport, observation, projections, and reconciliation decisions.

## Runtime boundary

The package has exactly four side-effecting primitives:

- `apply(bundle)` uses server-side apply with field manager `compartment`; a
  bootstrap-configured bundle may first create its allowed provisioning
  objects; a separate installation identity finishes by deleting explicitly
  named temporary authority, including after partial failure;
- `observe(labels)` reads label-scoped informer caches;
- `logs(ref)` reads workload or Job logs;
- `runJob(spec)` applies a deterministic Job and reads its terminal result.

The implementation uses `@kubernetes/client-node`. It must not implement raw
watching, object diffing, or a second write path. Pure naming, projection, and
state-transition functions remain package-owned support, not extra runtime
primitives.

`runJob` is a two-phase product protocol. It creates a deterministic Job only
when that name is absent, otherwise joins the existing Job and reads its
terminal state and complete logs. The returned capture enables TTL only after
the worker has durably persisted status, exit code, and logs. A timeout captures
available logs and returns a `timed-out` capture for the worker to persist; the
worker deletes the Job only after the database acknowledgement.
Release Jobs use `backoffLimit: 0`; Kubernetes never retries a release command.

## Identity and names

Namespaces and Kubernetes object names derive only from immutable database IDs
and must satisfy DNS-1123. Organization, project, environment, and service
names are mutable display metadata and belong only in labels or annotations
(D10). No selector accepts an ID, slug, or name fallback.

Every owned object carries immutable ownership labels. Informers admit and
reconcile only objects that satisfy the complete ownership selector.

## State and observation

Live Kubernetes state is not mirrored in the database. A cached status with
`observedAt` is diagnostic data, not authoritative state (D30).

The durable protocol follows the immutable T9 evidence linked below:

1. persist `desired` before writing Kubernetes;
2. apply the deterministic bundle, then persist `pending`;
3. persist `active` only after the informer observes the desired generation as
   Ready;
4. when an active object is deleted, drifts, or becomes non-Ready, write a
   drift audit event and return it to `pending` in the same transaction;
5. recover `desired` by applying, recover `pending` by reapplying only when the
   cache is absent or drifted, and recover `active` through the same level-
   triggered rules.

Informer callbacks are concurrent, repeatable signals. One database
transaction owns each state transition and its drift audit event.

## Informer lifecycle

`@kubernetes/client-node` informers do not reconnect after ordinary transport
errors. The package therefore owns one lifecycle wrapper per informer:

- restart from the error callback;
- capped exponential backoff with jitter;
- clear the affected cache slice and perform a full relist after HTTP 410,
  then emit `relist` only after the replacement informer connects with its
  fresh list;
- suppress clean-stop `AbortError`;
- expose health from the last successful connection, never from process liveness;
- keep one restart timer and one observed-at cache per informer.

The permanent kill matrix covers: after durable `desired` and before apply;
after apply and before `pending`; after `pending` and before Ready; and during a
concurrent informer callback. A separate permanent scenario cuts the watch,
requires reconnect/relist convergence, and verifies that HTTP 410 starts from a
new full list.

## Workload projection

Application rows project deterministically to Deployment and Service objects.
Project namespace provisioning projects the namespace-owned NetworkPolicy set
in the same reconciliation as P5 RBAC. Rolling parameters follow the immutable T1 evidence:
`maxUnavailable: 0`, `maxSurge: 1`, a 45-second progress deadline and
termination grace period, a 3-second `preStop`, and the documented readiness
probe timings. Failed rollout recovery reapplies the saved active manifest by
SSA; it does not use `kubectl rollout undo`.

Network isolation follows the T2 evidence. Secret projection follows the T5
no-service-account-token and checksum rollout model. Resource rows project to
`Recreate` Deployments, internal Services, Secrets, and stable PVC references.
PVC creation is a separate explicit bootstrap operation. Stateful updates stop
the old pod, prove absence, verify persisted claim UIDs, start the new manifest,
and restore the saved executable manifest on failure.

Resource backup and restore use durable product Jobs. They mount only the
per-resource artifact PVC, verify its persisted UID before execution, and use a
platform-worker verifier Job to persist and compare deterministic artifact
checksum and size. Restore verification finishes before the user restore command.

## Build pipeline

Cluster source builds run through one rootless BuildKit pod in a dedicated
build namespace. P9 exposes the platform build bundle for the existing `apply`
primitive and the permanent cluster harness; production controller wiring is
part of the later atomic cutover. No chart or additional Kubernetes write path
owns these objects. The namespace uses Pod Security `enforce=privileged` with
`audit=baseline` and `warn=baseline` because the tested AppArmor Unconfined
profile is not admitted by baseline enforcement. The pod keeps the exact T4
minimum security context and must never be described as baseline-compatible.

BuildKit has an 8 GiB PVC, a 2 GiB GC target, and at most two concurrent builds.
The worker and daily CronJob both use `buildctl prune --all --keep-duration 24h
--keep-storage 2000`. NetworkPolicy defaults the namespace to deny and admits
only selected worker ingress plus explicit DNS, base-image, and registry
egress. Public internet egress excludes metadata, link-local, Pod, and Service
CIDRs.

Bundled registry mode projects a private persistent registry into the build
namespace. External mode omits those objects and requires one explicit
endpoint, credential Secret, port, and egress CIDR. Application namespaces use
the P5 Secret path for deterministic Docker pull credentials. Kubelet registry
reachability is node-side and remains an explicit M-check.

Builds return only digest-pinned image references. BuildKit emits an SBOM OCI
attestation into the selected registry. Keyed signing and verification before
rollout are deferred to F2; P9 does not depend on public keyless Sigstore.

## Evidence

- [T9 state, informer, and kill-matrix report](https://github.com/compartmentdev/compartment/blob/89aefb745424be49aecdf9aba93b03fc027782e4/spike/t9/T9-REPORT.md)
- [T1 rolling report](https://github.com/compartmentdev/compartment/blob/0131f4d7f39013c7a38cc54d79c09e0befe4659e/spike/t1/T1-REPORT.md)
- [T2 NetworkPolicy templates](https://github.com/compartmentdev/compartment/blob/d32fa117c6c7192f1fb501e42b784c17af4ab220/spike/t2/policies.yaml.tpl)
- [T5 secrets and RBAC report](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/T5-REPORT.md)
- [T5 bootstrap RBAC](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/bootstrap-rbac.yaml)
- [T5 controller RBAC](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/controller-rbac.yaml)
- [T4 rootless BuildKit report](https://github.com/compartmentdev/compartment/blob/spike/t4/spike/t4/T4-REPORT.md)

## RBAC rollout

The bootstrap role and controller role are derived from the immutable T5 artifacts. No
production or seeded Compartment principal receives either role by default.
Fresh installs explicitly provision a short-lived bootstrap binding, delete it
after namespace provisioning, and create one namespace-local controller
binding per managed project. Existing projects require explicit backfill or
opt-in. Each later provisioning run requires installation authority to
re-establish the short-lived bootstrap binding before handing the bootstrap
identity to the controller. The bootstrap identity cannot recreate that
binding itself. This is Kubernetes installation authority, not a new
Compartment user permission.

## Migration and deletion

Replacement code has no compatibility fallback. Obsolete Docker/runtime-node
coordination is deleted vertically in the integration branch, and cutover to
`main` is one atomic merge (D31). P1 adds Kubernetes persistence fields and
tables only; `nodes`, `nodeId`, `containerId`, `drainingContainerId`,
`drainingNodeId`, and `upstream*` remain until cutover.

Every migration PR includes a delete list. Missing context is a stated PR
blocker, not an inferred fallback.

## Budget

Production runtime code in `packages/kube-runtime` is limited to 3,000 physical
lines. Tests and external scenario harnesses are reported separately. Exceeding
the limit stops the change until the PR contains a written justification (D33).

## Non-goals

- a portable scheduler or a second orchestrator;
- mirroring Kubernetes live state into PostgreSQL;
- raw watches, client-side diff/apply, or `kubectl` runtime calls;
- Docker-path removal before the integration cutover;
- P10 end-to-end coverage.
