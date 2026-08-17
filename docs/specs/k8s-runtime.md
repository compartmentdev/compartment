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
- `observe(labels)` reads label-scoped informer caches, including ReplicaSets used for revision cleanup;
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

A terminal rollout is cleaned up before failure is persisted, including an
application-readiness timeout or `ProgressDeadlineExceeded`. A cleanup error
leaves the failure unpersisted so reconciliation can retry. A first deployment
removes its projected Deployment, Service, and deployment-specific Secret. A
replacement rollout first restores the distinct active manifests, then removes
only the candidate Secret and ReplicaSets selected by the complete immutable
candidate ownership labels. Deployment and ReplicaSet deletion uses foreground
propagation and treats an absent object as already converged. A failed recovery
of the current active revision reapplies and retains that revision. Progressing,
intermediate, quota-admission, and transport-error observations never trigger
cleanup.

The controller ClusterRole grants its namespace-bound operator identity
`get`, `list`, `watch`, and `delete` on ReplicaSets. Helm manages that role for
both fresh installs and upgrades; the permission is not granted to product
principals or groups.

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
`maxUnavailable: 0` and `maxSurge: 1`. The termination grace period remains 45 seconds,
with a 3-second `preStop` and the documented readiness probe timings. Service Deployment
rollouts use an operator-configured pre-Running infrastructure deadline, defaulting to 10 minutes.
Their Kubernetes progress guard is that deadline plus the service readiness timeout, rounded up to seconds.
Application readiness time starts when the current candidate container first enters Running and is retained across
candidate container restarts. An unhealthy active candidate receives one recovery restart with a fresh application
window; later reconciliations do not reset that window, and the single-recovery guard survives worker replacement.
Failed rollout recovery reapplies the saved active manifest by SSA; it does not use `kubectl rollout undo`.
Resource rollouts use the same operator-configured infrastructure deadline independently for mounted-volume
provisioning and for reaching the resource container's first Running state. Their declared readiness budget starts at
that container's observed `Running.startedAt`; unused operation-only claims do not consume either budget.

Tenant node-pool scheduling is installation-owned and opt-in. When configured, application and generic-resource
Deployments plus product and provisioning Jobs project the tenant selector, tolerations, and `compartment-tenant`
PriorityClass. Official PostgreSQL resource images instead project the required worker data-scheduling contract,
which reads `nodePools.data` directly and never inherits the bundled-service system fallback. When a selected pool is
empty, its selector and tolerations are omitted from the desired Pod spec. A full installation rejects an empty data
selector, so user-created PostgreSQL cannot reach that unconstrained state. Empty optional tenant scheduling removes
previously applied tenant constraints when that workload next reconciles.
Build Jobs run tenant-authored code, so they carry the same `compartment-tenant` PriorityClass through their
always-configured build scheduling and never preempt tenant workloads.
Platform scheduling and the build node pool remain owned by the Helm chart.
Helm projects the `nodePools.data` selector and tolerations onto the bundled PostgreSQL and private registry Pod specs
through `compartment.dataNodePool`. The helper falls back to `nodePools.system` only when both the data selector and
tolerations are empty. Changing either single-replica workload's placement after it carries data updates its Pod spec,
recreates the Pod, and interrupts service. Storage reattachment and recovery depend on the provider and volume
topology.
Changing `nodePools.data` rolls the worker but does not enqueue tenant resources. Existing user-created PostgreSQL
Deployments adopt the new scheduling when an operator starts them again; fresh resources use it immediately.

Kernel sandboxing is installation-owned and required through `sandboxRuntime.runtimeClassName`.
The selected RuntimeClass is projected onto build Jobs, application Deployments, resource Deployments, product Jobs,
and provisioning Jobs. Platform workloads and `api-migrate` remain on the node default runtime.
PostgreSQL resources use the sandbox RuntimeClass without a separate
opt-out; the additional I/O cost is an accepted isolation tradeoff.

Network isolation follows the T2 evidence. Application Pods and product Jobs
carrying `compartment.dev/job-class` receive resource, kube-dns, and external
egress; resource ingress admits those two workload classes only. On the
supported CNI a denied connection surfaces to the client as a connection
refusal, not a timeout: the policy controller ends each per-Pod firewall chain
with `REJECT --reject-with icmp-port-unreachable`. Policy programming for a
newly created Pod is also not synchronous with container start, because every
peer selector is expanded into a source IP set that the new Pod's address only
joins on a later controller sync. A Pod's first packet to a policy-protected
peer can therefore be refused for a short interval after the Pod reaches
Running, while node-sourced traffic such as a kubelet probe is admitted ahead of
policy evaluation and never observes the interval.

Every Pod that dials a declared resource therefore carries a reachability init container ahead of its own
containers: application Deployments and the product Jobs that dial a resource alike. It runs the platform worker
image, which is the image reference the worker already holds, and it exits only once each declared resource
endpoint accepts a TCP connection from that Pod's own address. Proving reachability from the control plane cannot
substitute: the address whose policy programming is in question is the new Pod's, which does not exist yet when
any control-plane decision about it is made, and a Deployment scale-up or a rescheduled Pod produces one without
any reconcile to hang that decision on. A resource that declares no readiness publishes no
endpoint and a stopped resource is not expected to answer, so neither is waited on.

Each endpoint's bound is the resource's own declared readiness timeout, measured from container start rather than
from any control-plane instant, and clamped for a Job by that Job's remaining timeout so the wait cannot consume
the budget the command needs. Past the bound the container fails naming the endpoint it could not reach. For an
application the Pod stays pre-Running and the infrastructure deadline above governs the rollout; for a Job the
failure is the Job's terminal result, read from the init container's status because the Pod's own container never
started and has no logs to read. Secret
projection follows the T5 no-service-account-token and checksum rollout model. Resource rows project to
`Recreate` Deployments, internal Services, Secrets, and stable PVC references.
Release Jobs with descriptor-owned resource output bindings remain queued until
the latest reconcile for each connected resource succeeds, bounded by the
release timeout. A failed latest reconcile or a deleting/deleted connected
resource fails the release immediately. Releases without those bindings remain immediately claimable.

Claim eligibility is reconcile history, so it cannot see a resource Pod replaced after the claim.
Every claim therefore also carries the resources that Job dials and that declare readiness, resolved
inside the claim transaction: descriptor output bindings for a release, the operation's own resource
ids for a Job that runs against the resource itself. A Job that only mounts a resource's artifact
volume dials nothing, a stopped resource is never expected to accept connections, and a resource that
declares no readiness publishes no signal to consult; none of the three is gated. Each carried
resource has a deadline of its declared readiness timeout from the first claim.

Before creating the Job the worker performs one direct read per carried resource and requires the
current generation of that Deployment to be available. It never waits: an unready resource leaves the
Job claimable so the same controller lane can go on to reconcile that resource, and the Job is
admitted on a later claim. Once a carried resource is past its deadline and still unready, the Job is
durably failed without being created. The Kubernetes Job is created only after that admission, so the
mounted-claim identity fence stays the last check before creation.

Exclusion runs both ways. A resource reconcile is refused while any product Job that holds that
resource is in flight, so a managed update cannot scale a resource Deployment to zero under a Job that
is dialing it, and the wait that reconcile serves is budgeted from the same set. A release counts as
in flight from the moment the worker records that it is handing the manifest to the API server, which
it does before the call so that dying mid-submission over-fences instead of leaving a live Pod
invisible, until its Job is finalized. `status` cannot serve, because a row turns `running` when it is
claimed, which is before the gate above decides, and a gate that declines leaves a claimed release
that never reached the cluster. The record is written once; `updated_at` anchors the execution
deadline, so re-stamping it on a re-claim would keep a stuck Job from ever reaching a terminal status.

Recording that manifest is itself a claim on the resource, and it takes the same per-resource claim
locks the reconcile lane takes. The claim transaction cannot make this decision: it drops those locks
when it commits, and the gate that follows is a live Kubernetes read the control plane is not allowed
to make, so a reconcile can be claimed in between. Both sides therefore re-read their fence while
holding the locks, and exactly one proceeds: a record that lands first fences the reconcile, and a
reconcile that lands first refuses the record. A refused record creates no Job and leaves the row
claimable with nothing written, which is the same outcome as a resource that is not yet ready.

Age never fences a release: a queued release already yields to every pending reconcile, so ordering it
by age would let one block the reconcile that readies it. A resource operation keeps the age
tie-break, which is the matching half of its own claim rule, and keeps `status` as its in-flight test:
a second operation against the same resource is already refused by that same rule, so the claimed-but-
not-submitted window it admits cannot widen into the deadlock a release would hit.

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
overlayfs over per-Job gVisor tmpfs mounts. The default build timeout is 30 minutes. The build namespace uses
Pod Security `enforce=privileged` with
`audit=baseline` and `warn=baseline` because the BuildKit sidecar's Sentry-confined capabilities are outside baseline
Pod Security. Per-build ephemerality gives every build a fresh Pod and a fresh `emptyDir` workspace, then deletes that
Pod after result capture; it does not create a separate kernel boundary.

The Sentry serves those mounts from its own memory, so the build workspace is charged to the build Pod memory cgroup
and the Pod memory limit is the only bound that exists: the Sentry never reads the Kubernetes `sizeLimit`, and kubelet
cannot measure a mount it does not own. The declared volume sizes state what the Pod memory limit must fund, so the
build resource limits and the declared workspace are one contract. A build fails before it starts unless
`resources.buildkit` and `resources.buildRunner` together fund the whole declared workspace plus the BuildKit, runner,
and Sentry process memory that writes into it, and unless `buildkit.gcKeepStorageMb` reserves no more than the
`buildkit.dataSizeLimit` memory-backed BuildKit data volume. The defaults give each build Pod a 4Gi memory request and
limit covering the default 2Gi data volume, the other 1Gi of workspace, and 1Gi of process memory. Together with the
honest platform footprint and node reservations, one build fits the 12 GiB single-node host documented for
application builds.

The build Pod runs tenant-authored code, so it never carries the installation runtime control token. The worker mints
one HMAC-signed credential per build, pinned to that build's artifact id and outliving the Job's own
`activeDeadlineSeconds` by a fixed grace that covers the gap between minting and Job creation plus worker/API clock
skew. The API accepts that credential only on the source archive route and only for the artifact the credential names,
which is the source build Job's single API call; registry verification builds call nothing and carry no credential.
The signing key is derived from the runtime control token both processes already hold, so the scheme adds no
installation secret and no chart value. Verification is one HMAC with no database read on a route that is never
publicly routable, so the route takes no throttle. Admission limits the runner container to a fixed set of environment
variable names, requires each value to be projected from a Secret key, and refuses bulk `envFrom` import on both the
runner and the BuildKit sidecar, so no other credential can be named into a build Pod.

`sandboxRuntime.runtimeClassName` selects the verified gVisor RuntimeClass shared by builds and tenant workloads.
Installation fails before Helm when a real canary does not prove the gVisor userspace kernel boundary.
Fresh installs bind only the existing platform worker ServiceAccount to the namespaced Job, Secret, Pod, and Pod-log
permissions required by `runJob`; no tenant or seeded product principal receives Kubernetes authority.

### Sandbox E2E coverage

Every k3d shard installs the pinned gVisor package, configures runsc, and uses the real `gvisor` RuntimeClass. Each
shard also registers the runsc handler with `pod_annotations = ["dev.gvisor.spec.mount.*"]`, the same allow-list the
managed-VM installer requires; without it containerd drops the mount hints and builds run over gofer-backed volumes
that no installation uses. The build-matrix partitions remain the focused build-workload shards, and one of them
proves the build workspace is memory-backed by reading the sandbox mount table.
The fresh managed-VM workflow starts with no K3s or gVisor files and verifies runtime download, containerd
registration, RuntimeClass creation, and a real gVisor canary.
The fresh-VM workflow is dispatched only onto a disposable `compartment-fresh-vm` runner. The runner must have no
K3s or gVisor state before the job and must be destroyed after it; a persistent self-hosted runner is not valid for
this coverage path.

Each Job uses only `emptyDir` local cache and a project/service-scoped registry cache; no unencrypted cache volume is
shared between tenants. The worker admits up to 100 build claims by default, caps each organization at two active
claims, and chooses the least-active eligible organization before applying FIFO order. The build namespace
ResourceQuota independently limits aggregate container CPU and memory to the installation-configured hard ceiling.
NetworkPolicy defaults the namespace to deny and admits only DNS, source archive API, base-image, and registry
egress. Public internet egress excludes metadata, link-local, RFC1918, Pod, and Service CIDRs.

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

Each organization receives one logical Capsule quota pool, projected as five
`GlobalCustomQuota` resources and selected by its immutable organization label
across all managed project namespaces. The fixed pool permits 20 CPU requests
and limits, 20Gi memory requests and limits, and 100Gi requested PVC storage. Capsule admission evaluates
only Pod and PVC create and update requests in positively labeled
project namespaces and fails closed. A separate fail-open delete notification
lets Capsule release ledger capacity without making workload teardown depend on
webhook availability. A successful durable reconciliation row becomes eligible
for refresh after 15 minutes, behind pending and failed work, to repair accounting
if a notification is missed. Platform and build namespaces are outside that selector.
Existing workloads are not evicted when aggregate usage is over limit; new Pod
or PVC admission remains denied until deletion or downsizing releases capacity.
API state tracks only reconciliation readiness, never usage.
That state is created transactionally for every new organization. The leader
worker marks reconciliation successful only after it applies the quota objects.
Every new project namespace receives the immutable organization ID on its first
projection. Project namespace provisioning waits for that infrastructure
readiness, not for available quota usage. Reconciliation failures retry after
five seconds until the third attempt and every 15 minutes after that.
Deployment status reports the persisted infrastructure failure and next retry
time while the project remains pending.

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
