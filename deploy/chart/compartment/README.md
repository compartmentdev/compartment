# Compartment Helm chart

The supported installation path is `compartment install`. Release CLI binaries bundle the matching chart and perform
existing-cluster preflight before applying it.

## Requirements

- Kubernetes 1.30.0 or newer
- Helm 4.x
- an existing Ingress Controller
- cert-manager
- NetworkPolicy enforcement
- persistent storage
- installer access to the namespaced and cluster-scoped resources rendered by the chart

The chart does not install or disable cluster infrastructure and does not mutate nodes.

gVisor is an optional build-isolation enhancement. By default, ephemeral source-build Pods use each build node's
default container runtime. To add kernel-level sandboxing, install `runsc` on the build nodes, expose it through a
RuntimeClass, and set `buildkit.runtimeClassName` to that class name. The chart does not create a cluster-scoped
RuntimeClass unless `buildkit.createRuntimeClass` is explicitly enabled.

## Node pools and workload priority

`nodePools.system` schedules platform components, `nodePools.build` schedules ephemeral BuildKit Jobs, and
`nodePools.tenant` schedules application, resource, product, and provisioning workloads. An empty pool adds no
selector or toleration. An empty build pool falls back to the system pool.

Label and taint the nodes before enabling a pool:

```bash
kubectl label node platform-1 compartment.dev/node-pool=system
kubectl taint node platform-1 compartment.dev/node-pool=system:NoSchedule
kubectl label node builder-1 compartment.dev/node-pool=build
kubectl taint node builder-1 compartment.dev/node-pool=build:NoSchedule
kubectl label node tenant-1 compartment.dev/node-pool=tenant
kubectl taint node tenant-1 compartment.dev/node-pool=tenant:NoSchedule
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
```

Platform and ephemeral BuildKit Pods use the higher `compartment-platform` PriorityClass. Configured tenant workloads use
`compartment-tenant`, allowing a pending platform Pod to preempt lower-priority tenant Pods when both are eligible for
the same node. Priority does not guarantee availability during node failure or kubelet node-pressure eviction.

## Public ingress

Set `ingress.className` to the selected existing IngressClass. When that controller does not publish Ingress status,
set `ingress.endpoint.type` to `A`, `AAAA`, or `hostname` and provide `ingress.endpoint.value`. The installer persists
the equivalent typed targets in `ingress.targetsJson`. Managed domains require `A` or `AAAA`; use an operator-owned
base domain for a hostname endpoint because the managed-domain broker cannot publish CNAME records.

The chart renders exact console and application host rules with no catch-all host, default backend, or
controller-specific annotation. Caddy is reachable only through a ClusterIP Service on the internal HTTP port. Its
NetworkPolicy admits that port from cluster ingress sources.

## High availability

The chart runs `api`, `edge`, and `caddy` with two replicas by default. Each Deployment uses a rolling update with
`maxUnavailable: 0`, a `minAvailable: 1` PodDisruptionBudget when more than one replica is configured, and a soft
`kubernetes.io/hostname` topology spread constraint. The soft constraint preserves support for single-node clusters;
multiple schedulable nodes are required for node-failure tolerance.

API source archives are stored in PostgreSQL so either API replica can complete an in-flight deployment. During an
upgrade from a chart that used the API PVC, the migration Job imports retained archives before the HA rollout.
Authentication and app-access sessions are PostgreSQL-backed; edge resolves app-session cookies through the shared
API contract, while each edge replica independently refreshes its route and authorization snapshot. Persistent edge
snapshots and the optional API audit file sink are package-local recovery features and require their component to be
set to one replica.

Caddy is an internal HTTP proxy and has no persistent storage or certificate material. Ingress and cert-manager own
platform TLS certificates and Secrets.

This availability boundary does not include `worker`, `project-provisioner`, registry, or the bundled PostgreSQL
Deployment, which remain single replicas. Worker and project-provisioner failover requires future leader election.
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

Managed-domain installations use the bundled ACME DNS token-scoped solver only for one wildcard Certificate. The
console and the default `registry.<base-domain>` host reuse that wildcard Secret. Project custom domains use a
separate namespaced HTTP-01 Issuer, so their exact hostnames are never sent to the managed-domain broker. A managed
registry hostname outside the wildcard depth also uses that HTTP-01 Issuer unless it has an explicit different
issuer. For an operator-owned domain, set `tls.issuerRef.name` and `tls.issuerRef.kind` to an existing Issuer or
ClusterIssuer. `tls.existingSecret` may reference an existing `kubernetes.io/tls` Secret.

The selected Ingress and cert-manager path own public TLS. Compartment does not create, copy, or mount operator
certificate material.

## Install and recovery

```bash
compartment install
```

Source builds require `--chart ./deploy/chart/compartment`. Retry with the same context, namespace, release, and
values after repairing a failed preflight or Helm condition. The retained install-state Secret and registry resources
preserve installation identity across a supported reinstall.

Direct Helm use is an operator recovery path and bypasses CLI artifact verification:

```bash
helm upgrade --install compartment ./deploy/chart/compartment \
  --namespace compartment \
  --create-namespace \
  --values compartment-values.yaml \
  --rollback-on-failure \
  --wait \
  --wait-for-jobs \
  --timeout 15m
```

Pin verified image digests when using this path.

## Registry and workload isolation

The registry is a private ClusterIP workload. For an operator-owned base domain, the CLI derives
`registry.<base-domain>` and uses `registry.issuerRef` when explicitly set, otherwise the platform `tls.issuerRef`.
The hostname must resolve from every node to the retained registry Service. The chart never changes
container-runtime configuration or node trust.
The registry certificate must chain to a CA trusted by every node container runtime. The public platform certificate
must also be trusted by the machine running the CLI; a cert-manager self-signed issuer does not satisfy this contract.
Resolvers with DNS-rebinding protection must allowlist the operator base domain so the public registry name may
resolve to the retained cluster-only Service address.

Registry storage defaults to the retained PVC backend. Set `registry.storage.backend: s3` with the bucket, region,
optional regional endpoint, and path-style setting under `registry.storage.s3` to use S3-compatible object storage.
Set `registry.storage.s3.existingSecret` to a Secret in the release namespace containing `accessKey` and `secretKey`.
Populate the bucket before switching backends; the chart does not migrate blobs. The S3 backend leaves any retained
registry PVC unmounted and does not create one for new installations.

Project provisioning creates repository-scoped credentials and project-scoped image pull Secrets. NetworkPolicy
projections retain tenant isolation and the configured RFC1918 egress policy. Dockerfile, Railpack, BuildKit, and OCI
image behavior is unchanged.

## Usage metering

The platform samples tenant CPU and memory usage and flushes hosted application traffic aggregates every 60 seconds.
It retains hourly aggregates for 400 days by default. Set `platform.usageMeteringIntervalMs` and
`platform.usageRetentionDays` to tune collection overhead and database retention. Missed samples and unflushed edge
traffic are not reconstructed, and a longer retention window uses more database storage.
