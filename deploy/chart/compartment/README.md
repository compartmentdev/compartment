# Compartment Helm chart

The supported installation path is `compartment install`. Release CLI binaries bundle the matching chart and perform
existing-cluster preflight before applying it.

## Requirements

- Kubernetes 1.33.0 or newer (required for read-only image volumes used by sandboxed builds)
- Helm 4.x
- an existing Ingress Controller
- cert-manager
- an existing cert-manager CA Issuer or ClusterIssuer whose CA is already trusted by every node container runtime
- NetworkPolicy enforcement
- persistent storage
- gVisor installed on every node eligible for build or tenant workloads, with a working RuntimeClass
- installer access to the namespaced and cluster-scoped resources rendered by the chart

The chart installs Capsule 0.13.11 and enables fail-closed calculation admission for Pod and PVC creates and updates in
Compartment-managed project namespaces. Delete notifications fail open so teardown remains available; periodic quota
reconciliation repairs missed notifications. Platform and build namespaces are excluded by the positive namespace labels.

The chart does not install or disable cluster infrastructure and does not mutate nodes.

`platform.newProjectsPrivateByDefault` controls hosted-route access for projects created after the value is applied.
It defaults to `true`, which makes services without an explicit descriptor `accessMode` require authentication. Set it
to `false` to make omitted service access public for newly created projects. Existing projects retain the default they
received when they were created, and an explicit per-service `accessMode` always wins. This setting does not change
project permissions or RBAC.

The registry uses its private Service ClusterIP directly in image references and requests a certificate with that IP
address in its SAN. Public ACME issuers cannot issue certificates for private IP addresses. Installation therefore
fails unless the configured `registry.issuerRef` selects a CA issuer whose CA is already in every node's trust store.

The chart schedules builds and tenant workloads through the RuntimeClass selected by
`sandboxRuntime.runtimeClassName` (`gvisor` by default). The CLI verifies that class before Helm runs and owns runtime
installation only for managed VMs; the chart never installs runtimes or adopts an operator-owned RuntimeClass.

## Node pools and workload priority

`nodePools.system` schedules the remaining platform components, `nodePools.build` schedules ephemeral BuildKit Jobs,
`nodePools.tenant` schedules applications, generic resources, product Jobs, and provisioning Jobs, and
`nodePools.data` schedules user-created PostgreSQL resources plus the bundled PostgreSQL and private registry. An
empty system or tenant pool adds no selector or toleration. An empty build pool falls back to `nodePools.system`.
Bundled data services also fall back to `nodePools.system` during the foundation stage. A full installation requires
`nodePools.data.nodeSelector`; user-created PostgreSQL receives that data pool configuration directly and never
inherits system scheduling.

Managed-VM installation writes the data selector and labels its node automatically. Existing-cluster installs and
upgrades from releases with an empty data selector must label a data node and provide `nodePools.data.nodeSelector`
before rendering the full stage.

Production installations should separate bundled PostgreSQL and the private registry from platform workloads that
are rescheduled on every upgrade. Moving either Deployment later recreates its Pod and interrupts the service;
bundled PostgreSQL and a filesystem-backed registry also reattach persistent volumes. Configure `nodePools.data`
before the installation carries real data. After updating `nodePools.data`, run
`compartment resource start --resource <name> --project <name> --env <name>` for each existing PostgreSQL resource.
The command reconciles the resource onto the new pool and interrupts it while Kubernetes recreates its Pod; the chart
does not enqueue all existing resources during an upgrade.

Label and taint the nodes before enabling a pool:

```bash
kubectl label node platform-1 compartment.dev/node-pool=system
kubectl taint node platform-1 compartment.dev/node-pool=system:NoSchedule
kubectl label node builder-1 compartment.dev/node-pool=build
kubectl taint node builder-1 compartment.dev/node-pool=build:NoSchedule
kubectl label node tenant-1 compartment.dev/node-pool=tenant
kubectl taint node tenant-1 compartment.dev/node-pool=tenant:NoSchedule
kubectl label node data-1 compartment.dev/node-pool=data
kubectl taint node data-1 compartment.dev/node-pool=data:NoSchedule
```

Then configure the matching selectors and tolerations:

```yaml
nodePools:
  system:
    nodeSelector: { compartment.dev/node-pool: system }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: system, effect: NoSchedule }
  build:
    nodeSelector: { compartment.dev/node-pool: build }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: build, effect: NoSchedule }
  tenant:
    nodeSelector: { compartment.dev/node-pool: tenant }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: tenant, effect: NoSchedule }
  data:
    nodeSelector: { compartment.dev/node-pool: data }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: data, effect: NoSchedule }
```

Platform Pods use the higher `compartment-platform` PriorityClass. Ephemeral BuildKit Pods run tenant-authored code, so
they share `compartment-tenant` with configured tenant workloads and never preempt them. That lets a pending platform
Pod preempt lower-priority tenant Pods when both are eligible for the same node. Priority does not guarantee
availability during node failure or kubelet node-pressure eviction.

`capacityHeadroom.replicas` controls preemptible tenant-capacity placeholders for a compatible cluster autoscaler.
Set it to zero to accept saturation or increase it to reserve more free allocations. The operator owns autoscaler
installation, node bootstrap, kubelet reservations, and eviction policy.

## Public ingress

Set `ingress.className` to the selected existing IngressClass. When that controller does not publish Ingress status,
set `ingress.endpoint.type` to `A`, `AAAA`, or `hostname` and provide `ingress.endpoint.value`. The installer persists
the equivalent typed targets in `ingress.targetsJson`. Managed domains require `A` or `AAAA`; use an operator-owned
base domain for a hostname endpoint because the managed-domain broker cannot publish CNAME records.

The chart renders exact console and application host rules with no catch-all host, default backend, or
controller-specific annotation. Caddy is reachable only through a ClusterIP Service on the internal HTTP port. Its
NetworkPolicy admits that port from cluster ingress sources.

## Platform metrics

Set `platformMetrics.enabled: true` to render a `PodMonitor` for API, worker, project-provisioner, and Edge Pods. The
dedicated metrics port defaults to `9464` and is never added to public ingress or a Service. Configure
`platformMetrics.namespaceSelector` and, when needed, `platformMetrics.podSelector` for the Prometheus Pods; the chart
always denies other access to the metrics port and, when enabled, admits exactly those peers. The namespace selector
must not be empty.

## High availability

The chart runs `api`, `edge`, `caddy`, `worker`, and `project-provisioner` with one replica by default. Each Deployment
uses a rolling update with `maxUnavailable: 0`, a `minAvailable: 1` PodDisruptionBudget when more than one replica is
configured, and a soft `kubernetes.io/hostname` topology spread constraint. The soft constraint preserves support for
single-node clusters; multiple schedulable nodes are required for node-failure tolerance.

API source archives are stored in PostgreSQL so either API replica can complete an in-flight deployment.
Authentication and app-access sessions are PostgreSQL-backed; edge resolves app-session cookies through the shared
API contract, while each edge replica independently refreshes its route and authorization snapshot. Persistent edge
snapshots and the optional API audit file sink are package-local recovery features and require their component to be
set to one replica.

Caddy is an internal HTTP proxy and has no persistent storage or certificate material. The main Caddy container does
not start, and the replacement Pod is not Ready, until an init container reaches a chart-owned target through the same
namespace-and-Pod-selected ingress policy used by tenant applications. Together with zero unavailable replicas this
keeps the previous proxy serving while a policy controller admits the new Pod IP. The proof is bounded: after five
minutes the replacement starts anyway and logs the failure, so an unavailable readiness target can delay a rollout but
never wedge an install or update.
Ingress and cert-manager own platform TLS certificates and Secrets.

Worker and project-provisioner use separate namespaced Kubernetes Leases so only one replica claims or reconciles
work. Lease duration, renew deadline, and retry period default to 15 seconds, 10 seconds, and 2 seconds respectively;
the renew deadline must remain shorter than the lease duration. Standby replicas remain warm without running build,
provisioning, reconcile, metering, or cleanup work. The registry and bundled PostgreSQL Deployment remain single
replicas.
For production, use an HA external PostgreSQL service:

```yaml
postgres:
  external:
    enabled: true
    existingSecret: compartment-production-postgres
    databaseUrlKey: database-url
    passwordKey: postgres-password
```

The referenced Secret must exist in the release namespace. `databaseUrlKey` must contain the PostgreSQL DSN and
`passwordKey` must contain the matching password. When external PostgreSQL is enabled, the chart does not render the
bundled PostgreSQL Service, Deployment, or PVC; the API and migration Job read the configured keys directly.

## TLS

Managed-domain installations use the bundled ACME DNS token-scoped solver only for the public wildcard Certificate
used by the console and application hosts. Project custom domains use a separate namespaced HTTP-01 Issuer, so their
exact hostnames are never sent to the managed-domain broker. The private registry has a separate Certificate for its
retained Service ClusterIP and the selected `registry.issuerRef`. Operator-owned domains default to external TLS
termination with platform HTTP. Alternatively, `tls.existingSecret` may reference an existing `kubernetes.io/tls`
Secret in the release namespace, or `tls.issuerRef` may reference an existing Ready cert-manager Issuer or
ClusterIssuer with a DNS-01 solver. In issuer mode, the chart creates one wildcard Certificate and cert-manager
renews it automatically. The operator owns the issuer and its DNS provider credentials.

The selected Ingress and cert-manager path own public TLS. Compartment does not copy or mount operator certificate
material.

## Install and recovery

```bash
compartment install
```

Source builds require `--chart ./deploy/chart/compartment`. Retry with the same context, namespace, release, and
unchanged values after repairing a failed preflight or Helm condition. Platform replacements are fresh installations
in an empty namespace.

Direct Helm use is an operator recovery path and bypasses CLI artifact verification:

```bash
helm install compartment ./deploy/chart/compartment \
  --namespace compartment \
  --create-namespace \
  --values compartment-values.yaml \
  --wait \
  --wait-for-jobs \
  --timeout 15m
```

Pin verified image digests when using this path. Prefer `compartment install`, which also performs existing-cluster
preflight and first-owner bootstrap.

## Registry and workload isolation

Size tenant container resources and project and organization quotas together. Memory requests determine scheduler
density; memory limits and quotas bound what workloads may consume.

The registry is a private ClusterIP workload. The CLI reads the retained registry Service ClusterIP and writes that
address to `registry.hostname`; it does not derive the registry address from the public base domain. The registry
uses `registry.issuerRef`; it is required independently of the operator-owned public TLS mode. The chart never changes
container-runtime configuration or node trust.
The registry certificate must chain to a CA trusted by every node container runtime. The public platform certificate
must also be trusted by the machine running the CLI; a cert-manager self-signed issuer does not satisfy this contract.

Registry storage defaults to the retained PVC backend. Set `registry.storage.backend: s3` with the bucket, region,
optional regional endpoint, and path-style setting under `registry.storage.s3` to use S3-compatible object storage.
Set `registry.storage.s3.existingSecret` to a Secret in the release namespace containing `accessKey` and `secretKey`.
Populate the bucket before switching backends; the chart does not migrate blobs. The S3 backend leaves any retained
registry PVC unmounted and does not create one for new installations.

Docker Hub base-image pulls use a separate, internal pull-through cache with a retained `20Gi` PVC by default.
Set `storage.dockerHubCache` to a bounded Kubernetes quantity sized for the base-image working set. To authenticate
cache misses to Docker Hub, set `dockerHubCache.credentials.existingSecret` to a Secret in the release namespace
containing `username` and `password`. The chart never creates or stores those credentials. BuildKit prefers this
cache and uses its native direct Docker Hub fallback only while the cache is unavailable or a mirrored request fails.

Project provisioning creates repository-scoped credentials and project-scoped image pull Secrets. NetworkPolicy
projections retain tenant isolation and the configured RFC1918 egress policy. OCI output and artifact-registry
behavior are unchanged.

## Usage metering

The platform samples tenant CPU and memory usage and flushes hosted application traffic aggregates every 60 seconds.
It retains hourly aggregates for 400 days by default. Set `platform.usageMeteringIntervalMs` and
`platform.usageRetentionDays` to tune collection overhead and database retention. Missed samples and unflushed edge
traffic are not reconstructed, and a longer retention window uses more database storage.
