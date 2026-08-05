# Kubernetes Runtime

Status: implemented (F1 cutover)
Updated: 2026-07-20

## Ownership

`@compartment/kube-runtime` is the only package allowed to write workload
objects to Kubernetes. Kubernetes is the only
runtime target and there is no generic multi-orchestrator abstraction (D9).

The database owns desired state, configuration, versions, history, and audit.
Kubernetes owns live state. API owns persistence and transactions, worker owns
asynchronous deployment orchestration, and `kube-runtime` owns Kubernetes
transport, observation, projections, and reconciliation decisions.

Compartment encrypts tenant variable values in PostgreSQL and decrypts them only for an authorized read or Kubernetes
Secret projection. The resulting Kubernetes Secret still resides in the cluster's etcd. BYO cluster operators should
enable Kubernetes API server encryption at rest for Secrets; Compartment does not configure or manage the cluster's
etcd encryption provider.

## Runtime boundary

The package exposes eight Kubernetes transport primitives. Only `apply`,
`delete`, and `runJob` write Kubernetes state:

- `apply(bundle)` uses server-side apply with field manager `compartment`; a
  bootstrap-configured bundle may first create its allowed provisioning
  objects; a separate installation identity finishes by deleting explicitly
  named temporary authority, including after partial failure;
- `observe(labels)` reads label-scoped informer caches;
- `read(object)` performs a direct API-server read for ownership and freshness
  fences;
- `delete(objects)` deletes exact projected objects, with UID and resource
  version preconditions where data ownership requires them;
- `observePodMetrics({ labels, namespaces })` reads resource usage for label-selected pods in explicitly supplied namespaces;
- `logs(ref)` reads workload or Job logs;
- `runJob(spec)` applies a deterministic Job and reads its terminal result.
- `leaderElection(config)` coordinates one active controller through a namespaced `coordination.k8s.io/v1` Lease.

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

Worker and project-provisioner each use a separate Lease in the platform namespace. Standby replicas initialize their
API and Kubernetes clients but do not claim or reconcile work. A terminating leader stops accepting new work, renews
through the current operation, and releases its Lease only after that operation drains. A replacement worker
immediately requeues an unfinished build claim and joins the deterministic build Job; the database claim remains the
single queue-ownership mechanism.

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
3. persist `active` only after a direct read observes the desired generation as
   Ready;
4. tolerate transient non-Ready reads for an active Deployment and return it to
   `pending` only after Kubernetes reports `ProgressDeadlineExceeded`;
5. recover `desired` by applying, recover `pending` by reapplying only when the
   object is absent, and recover `active` through the same stateless direct-read
   rules. Failed candidate recovery reapplies the previous active manifests but
   never blocks the controller on a second observation loop.

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
after apply and before `pending`; after `pending` and before Ready; and during
concurrent observation persistence. A separate permanent scenario cuts the watch,
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

Tenant node-pool scheduling is installation-owned and opt-in. When configured, application and resource Deployments
plus product and provisioning Jobs project the tenant selector, tolerations, and `compartment-tenant` PriorityClass.
When it is absent, all three Pod fields are omitted so existing server-side-apply ownership remains unchanged.
Platform and build scheduling remains owned by the Helm chart.

Kernel sandboxing is installation-owned and required through `sandboxRuntime.runtimeClassName`.
The selected RuntimeClass is projected onto build Jobs, application Deployments, resource Deployments, product Jobs,
and provisioning Jobs. Platform workloads and `api-migrate` remain on the node default runtime.
PostgreSQL resources use the sandbox RuntimeClass without a separate
opt-out; the additional I/O cost is an accepted isolation tradeoff.

Network isolation follows the T2 evidence. Application Pods and product Jobs
carrying `compartment.dev/job-class` receive resource, kube-dns, and external
egress; resource ingress admits those two workload classes only. Secret
projection follows the T5 no-service-account-token and checksum rollout model. Resource rows project to
`Recreate` Deployments, internal Services, Secrets, and stable PVC references.
Release Jobs with descriptor-owned resource output bindings remain queued until
the latest reconcile for each connected resource succeeds, bounded by the
release timeout. A failed latest reconcile or a deleting/deleted connected
resource fails the release immediately. Releases without those bindings remain immediately claimable.
PVC creation is a separate explicit bootstrap operation. Stateful updates stop
the old pod, prove absence, verify persisted claim UIDs, start the new manifest,
and restore the saved executable manifest on failure. A live workload without
a complete executable rollback snapshot is refused before the first scale-to-zero.

Resource backup and restore use durable product Jobs. They mount only the
per-resource artifact PVC, verify its persisted UID before execution, and use a
platform-worker verifier Job to persist and compare deterministic artifact
checksum and size. Restore verification finishes before the user restore command.

## Build pipeline

Each cluster source build runs as one deterministic worker-owned Kubernetes Job. The Job contains the build runner
and a BuildKit sidecar, joins an existing Job after worker recovery, and is deleted after its result and logs are
captured. The worker image owns the compatible BuildKit, Railpack, and runc binaries. The chart owns resources,
scheduling, namespace RBAC, admission, and network isolation; no long-lived BuildKit Deployment or Service exists.
BuildKit runs as root with the exact required capabilities inside the installation-selected gVisor Sentry and uses
overlayfs over bounded, per-Job gVisor tmpfs mounts. The default build timeout is 30 minutes. The build namespace uses
Pod Security `enforce=privileged` with
`audit=baseline` and `warn=baseline` because the BuildKit sidecar's Sentry-confined capabilities are outside baseline
Pod Security. Per-build ephemerality gives every build a fresh Pod and bounded `emptyDir` workspace, then deletes that
Pod after result capture; it does not create a separate kernel boundary.
`sandboxRuntime.runtimeClassName` selects the verified gVisor RuntimeClass shared by builds and tenant workloads.
Installation fails before Helm when a real canary does not prove the gVisor userspace kernel boundary.
Fresh installs bind only the existing platform worker ServiceAccount to the namespaced Job, Secret, Pod, and Pod-log
permissions required by `runJob`; no tenant or seeded product principal receives Kubernetes authority.

### Sandbox E2E coverage

Every k3d shard installs the pinned gVisor package, configures runsc, and uses the real `gvisor` RuntimeClass. The
dedicated `gvisor-build` shard remains the focused build-workload partition.
The fresh managed-VM workflow starts with no K3s or gVisor files and verifies runtime download, containerd
registration, RuntimeClass creation, and a real gVisor canary.
The fresh-VM workflow is dispatched only onto a disposable `compartment-fresh-vm` runner. The runner must have no
K3s or gVisor state before the job and must be destroyed after it; a persistent self-hosted runner is not valid for
this coverage path.

Each Job uses only `emptyDir` local cache and a project/service-scoped registry cache; no unencrypted cache volume is
shared between tenants. The worker's existing limit of two concurrent builds now limits build pods. NetworkPolicy
defaults the namespace to deny and admits only DNS, source archive API, base-image, and registry egress. Public
internet egress excludes metadata, link-local, RFC1918, Pod, and Service CIDRs.

The F1 chart installs a private persistent bundled registry. External/BYO
registry values are deferred to F2. Application namespaces use
the P5 Secret path for deterministic Docker pull credentials. Kubelet registry
reachability is node-side and remains an explicit M-check.

BuildKit pushes OCI images to the selected registry, and builds return only digest-pinned image references. Registry
cache import and export use the project/service-scoped cache repository for both Dockerfile and Railpack source builds.

## Evidence

- [T9 state, informer, and kill-matrix report](https://github.com/compartmentdev/compartment/blob/89aefb745424be49aecdf9aba93b03fc027782e4/spike/t9/T9-REPORT.md)
- [T1 rolling report](https://github.com/compartmentdev/compartment/blob/0131f4d7f39013c7a38cc54d79c09e0befe4659e/spike/t1/T1-REPORT.md)
- [T2 NetworkPolicy templates](https://github.com/compartmentdev/compartment/blob/d32fa117c6c7192f1fb501e42b784c17af4ab220/spike/t2/policies.yaml.tpl)
- [T5 secrets and RBAC report](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/T5-REPORT.md)
- [T5 bootstrap RBAC](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/bootstrap-rbac.yaml)
- [T5 controller RBAC](https://github.com/compartmentdev/compartment/blob/50986e66c3b2cc116644c245fd458ac80916a005/spike/t5/controller-rbac.yaml)

## RBAC rollout

The bootstrap role and controller role are derived from the immutable T5 artifacts. No
production or seeded Compartment principal receives either role by default.
Fresh installs require Kubernetes 1.30 or newer and install a fail-closed
`ValidatingAdmissionPolicy`. Every short-lived bootstrap ServiceAccount is
named after its immutable `cpt-*` target namespace. Admission permits that
identity to create the namespace and canonical controller RoleBindings only
when the request namespace matches the encoded target; the same request in
`kube-system` is denied. The bootstrap ClusterRoleBinding is deleted after the
Job and the admission guard remains permanent.

Provisioning Jobs, their ServiceAccounts, and their environment Secrets live
in a dedicated provisioning namespace. The permanent provisioner can manage
those ephemeral objects there, but it cannot read platform-namespace Secrets
or create Jobs there. Its ClusterRoleBinding mutation authority is restricted
to the fixed bootstrap binding. No production or seeded Compartment principal
receives Kubernetes authority.

Project provisioning uses one leased state machine. Every execution first
removes deterministic bootstrap-authority remnants, reapplies the authority,
runs or rejoins the deterministic Job, and completes only after authority
cleanup succeeds. An expired in-flight lease is reclaimed without consuming a
new failed attempt; only acknowledged provisioning failures count toward the
three-attempt terminal limit. A third failed completion fails waiting deployment
operations and resource reconcile runs instead of leaving them unclaimable.
Existing project controller RoleBindings remain unchanged; new projects and
explicit retries use the target-bound bootstrap identity.

## Migration and deletion

Replacement code has no compatibility fallback. Obsolete host-runtime
coordination is deleted vertically, and cutover to `main` is one atomic merge
(D31). The squashed baseline contains Kubernetes persistence only.

Every migration PR includes a delete list. Missing context is a stated PR
blocker, not an inferred fallback.

## Budget

The coordination core in `packages/kube-runtime` is limited to 1,500 physical
lines (D33). The core is `kube-runtime.ts`, `kube-observation.ts`,
`kube-job.ts`, `kube-rollout.ts`, `kube-informer-registration.ts`,
`kube-runtime-operations.ts`, `kube-naming.ts`, `kube-runtime-factory.ts`, and
`kube-client-node.ts`. Declarative projections (`*-projection*.ts`),
provisioning, and `*.types.ts` are counted and reported separately and remain
subject to the zero-duplication check. Agent, worker, tests, and external
scenario harness code are reported separately. Exceeding the core limit stops
the change until the PR contains a written justification.

## Non-goals

- a portable scheduler or a second orchestrator;
- mirroring Kubernetes live state into PostgreSQL;
- raw watches, client-side diff/apply, or `kubectl` runtime calls;
