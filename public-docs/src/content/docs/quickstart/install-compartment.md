---
title: Install Compartment
description: Install Compartment on a clean VM or into an existing Kubernetes cluster.
---

Compartment always runs on Kubernetes. Choose between a Compartment-managed VM and an existing cluster in
[Install Modes](/install-operate/install-modes/), then choose the public DNS and TLS model in
[Install Domain](/install-operate/install-domain/).

## Install the CLI

```bash
curl -fsSL https://compartment.dev/install.sh | sh
compartment install
```

This is the supported clean-VM path for an x86_64 host, tested on Ubuntu 24.04 LTS. The bootstrap downloads and verifies the CLI
without root. The CLI checks the host, shows one mutation review, and requests sudo only after you confirm it. On a
clean host without a usable Kubernetes context, it offers to install managed Kubernetes before installing Helm,
cert-manager, registry trust, and Compartment. It also installs and verifies the required gVisor sandbox; installation
stops if that verification fails.

Add `--verbose` to show Cosign, ORAS, and checksum diagnostics during installation.

## Prepare a clean VM

Use a fresh x86_64 VM with systemd, cgroup v2, sudo access, a public IPv4 address, and at least 40 GiB free storage.
Ubuntu 24.04 LTS is tested; for the platform and already-built applications, use at least 2 vCPU, 8 GiB memory, and 50 GiB free storage. A 4 GiB host no longer fits.
For source builds, use 4 vCPU, 12 GiB memory, and 80 GiB storage for one concurrent build; add 4 GiB memory for each additional build.
Ports 80 and 443 must be available and reachable. Compartment never changes port 22 or cloud security-group rules.

The installer blocks Kubernetes API, etcd, kubelet, and overlay ports on the public interface with persistent,
Compartment-owned firewall rules before k3s starts. It refuses to adopt a foreign Kubernetes, k3s, containerd,
or CNI installation. Use a clean host or select the existing-Kubernetes target explicitly.

You can run every read-only check without changing the host:

```bash
compartment install --target vm --check --output json
```

For automation, pass `--target vm`, `--yes`, owner inputs, and `--admin-password-file <path>` (or `-` for stdin).
Do not put the password on the command line.

## Use an existing Kubernetes cluster

The existing-Kubernetes path remains available for operator-managed clusters. Compartment requires Kubernetes 1.30
or newer and verifies the required APIs and runtime capabilities before installation. The exact managed k3s version
is an installation pin, not an upper compatibility limit for existing clusters.

A single-node installation is not highly available: a node outage interrupts the control plane and any tenant
workloads scheduled on that node.

Before installation, also provide:

- `helm` 4.0.0 or newer on `PATH` (`helm version --short`);
- `kubectl` 1.30.0 or newer on `PATH` and within one minor version of the target Kubernetes API server
  (`kubectl version --client`);
- for issuer-managed public TLS, a Ready Issuer or ClusterIssuer with an ACME DNS-01 solver;
- a separate cert-manager CA Issuer or ClusterIssuer for the private registry, with its CA already trusted by every
  node container runtime and the machine running the CLI;
- NetworkPolicy enforcement;
- a persistent storage class;
- gVisor installed on every Ready schedulable node, with a working RuntimeClass;
- credentials permitted to install the Helm release and its cluster-scoped policy resources.

The installer does not install or disable an ingress controller, reserve node ports, or change node container-runtime
configuration.

The private registry uses its retained Service ClusterIP directly. The installer derives this address after the
foundation stage and requests a Certificate with the address in its IP SAN. It does not require registry DNS or
modify node host/runtime configuration. Public ACME issuers cannot issue this private IP certificate; configure
`registry.issuerRef` with the node-trusted CA issuer. Reinstalling recomputes the address and registry Certificate.

Optional Helm values can assign the remaining platform workloads, builds, tenant workloads, and the bundled
PostgreSQL and private registry to separately labeled and tainted nodes through `nodePools.system`, `nodePools.build`,
`nodePools.tenant`, and `nodePools.data`. Leave all four pools empty for single-node clusters.
When pools are enabled, a pending platform Pod can preempt lower-priority tenant Pods that are eligible for the same
node. Build Pods run at tenant priority, so a build never preempts a running application. Priority does not guarantee
availability during node failure or kubelet node-pressure eviction.

For production installations, configure `nodePools.data` before PostgreSQL or the private registry carries real data.
Moving either Deployment later recreates its Pod and interrupts the service. Bundled PostgreSQL and a filesystem-backed
registry also reattach persistent volumes.

Hosted application traffic is limited per application to 300 requests per second with a burst of 600, per client IP
within an application to 60 requests per second with a burst of 120, and to 512 simultaneous in-flight requests per
application. Override these values under `platform.edgeTrafficLimits`; set either `requestsPerSecond` or `burst` to
`0` to disable a token bucket, or set `inFlight` to `0` to disable the connection cap. These limits are held in memory
and apply independently to each Caddy replica. Token-bucket rejections return `429` with `Retry-After`; in-flight
rejections return `503`.

Label and taint nodes before enabling a pool, then create `compartment-values.yaml` with matching values:

```yaml
nodePools:
  system:
    nodeSelector: { compartment.dev/node-pool: system }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: system, effect: NoSchedule }
  build:
    nodeSelector: {}
    tolerations: []
  tenant:
    nodeSelector: { compartment.dev/node-pool: tenant }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: tenant, effect: NoSchedule }
  data:
    nodeSelector: { compartment.dev/node-pool: data }
    tolerations:
      - { key: compartment.dev/node-pool, operator: Equal, value: data, effect: NoSchedule }
```

Empty system and tenant pools omit scheduling constraints. Empty build and data pools use the system pool's selector
and tolerations. Pass the file to `compartment install` with `--values compartment-values.yaml`.

New projects require authentication for hosted application routes by default. To make omitted service access public
for projects created after installation or upgrade, set the following Helm value:

```yaml
platform:
  newProjectsPrivateByDefault: false
```

The value is saved on each project when that project is created. Changing it later affects only new projects. An
explicit service `accessMode` in `compartment.yml` overrides the saved project default. This controls hosted app
access, not project permissions or RBAC.

Tenant CPU, memory, and storage budgets are installation values. The defaults reserve and cap each container at
512Mi of memory, request 50m CPU, and retain a 1 CPU hard limit. Each project and organization has matching 8 GiB
memory request and limit budgets, a 2 CPU request budget, an 8 CPU limit, and 20 GiB of requested storage. The matching memory values admit at
up to 16 default containers by memory without scheduling them more densely than their possible memory use. The 8 CPU
limit remains binding at eight default containers overall. Override the values together when sizing tenant capacity:

```yaml
resources:
  projectContainerDefaults:
    request: { cpu: 75m, memory: 512Mi }
    limit: { cpu: '1', memory: 512Mi }
  projectQuota:
    requestsCpu: '3'
    requestsMemory: 12Gi
    limitsCpu: '12'
    limitsMemory: 12Gi
    requestsStorage: 30Gi
  organizationQuota:
    requestsCpu: '4'
    requestsMemory: 16Gi
    limitsCpu: '16'
    limitsMemory: 16Gi
    requestsStorage: 40Gi
```

Organization quota changes are applied by periodic reconciliation. This release advances the project isolation
revision, so a system upgrade requeues every existing managed project after its organization quota is ready and
server-side-applies the current project quota and container defaults. Later value-only changes require a newer
isolation revision to requeue projects that already completed this revision. Application capacity is constrained by
configured resource and object-count quotas and by workload requests and limits; there is no separate application-count
value. Project object-count quotas remain fixed.

The configured CPU and memory requests must not exceed their limits. The worker and project provisioner reject
invalid Kubernetes quantities and requests above their limits. Lowering a memory request below its limit permits
overcommit: the scheduler can admit more memory than the node has, and under pressure the kernel may kill a
neighbouring application or PostgreSQL.

Build concurrency has separate logical and physical limits. Size the queue limits, namespace quota, and
`resources.buildkit` and `resources.buildRunner` together for the concurrency the cluster can support.

Builds run inside gVisor, which serves the build workspace from sandbox memory. A build Pod's memory limit therefore
covers its whole scratch space, not just its processes. Keep the two container memory limits at least 4 GiB in total;
otherwise the build fails before it starts. Raise both limits together for larger source builds, and keep
`buildkit.gcKeepStorageMb` within the memory-backed BuildKit data volume.

The namespace quota requires every build container to declare CPU and memory limits. Before upgrading, replace the
removed `buildkit.maximumConcurrentBuildsPerProject` key with `buildkit.maximumConcurrentBuildsPerOrganization`.
Values files that pin earlier build resources must either remove those pins or keep the two memory limits at least
4 GiB in total and set `buildkit.gcKeepStorageMb` to 2147 or less.

The namespace quota does not return a claimed build to Compartment's fair queue. If the quota blocks its Pod, the
Kubernetes Job continues consuming the configured build timeout while it waits for capacity. Sustained quota
saturation can therefore fail builds; size the quota for the concurrency you expect or increase `buildkit.timeoutMs`
to cover the expected wait.

For an existing cluster, configure the operator-installed RuntimeClass listed above. Compartment does not mutate
operator-managed nodes:

```yaml
sandboxRuntime:
  runtimeClassName: gvisor
```

Follow the official [gVisor containerd installation guide](https://gvisor.dev/docs/user_guide/containerd/quick_start/).
Before Helm runs, Compartment launches a digest-pinned canary on each Ready schedulable node and fails closed unless
the Pod proves the configured gVisor kernel boundary. Builds and tenant workloads use this class; platform components
keep the node default runtime. Nodes must reach `registry-1.docker.io` to pull the canary image during preflight.

Compartment samples tenant CPU and memory usage every 60 seconds and retains hourly aggregates for 400 days by
default. The metering interval also controls hosted application traffic flushes. Use
`platform.usageMeteringIntervalMs` and `platform.usageRetentionDays` to tune collection overhead and database
retention. Missed samples and unflushed edge traffic are not reconstructed, and longer retention uses more database
storage.

## Run the installer

Select the existing-Kubernetes target explicitly in automation:

```bash
KUBECONFIG=./kubeconfig compartment install --target kubernetes --kube-context production
```

The managed Compartment domain is the default public-domain choice and requires no prior domain preparation. The
installer allocates the domain with the discovered IPv4 or IPv6 Ingress endpoint, retains the returned acme-dns token,
and waits for the resulting Certificates to become ready. If the Ingress endpoint is a hostname, managed domains are
unavailable because the broker publishes only A/AAAA records. The installer does not resolve cloud load-balancer
hostnames into unstable IPs; choose an operator-owned base domain instead. Both domain modes still require the
node-trusted registry CA issuer described below.

When you select an operator-owned base domain, the wizard also asks how public TLS is provided. Choose an existing
cert-manager `Issuer` or `ClusterIssuer`, choose an existing `kubernetes.io/tls` Secret, or terminate TLS externally
and let Compartment serve HTTP. The private registry always needs its own issuer. Existing Secret mode requires the
namespaced Secret in the release namespace (`--namespace`, default `compartment`). Issuer mode requires a namespaced
`Issuer` there or a cluster-scoped `ClusterIssuer`. External TLS mode requires neither public certificate resource.
Create the namespace first when you use namespaced certificate resources.

The public issuer must report `Ready=True` and have at least one ACME DNS-01 solver because HTTP-01 cannot issue a
wildcard certificate. Do not select an issuer with `spec.selfSigned`. A public ACME issuer cannot issue the registry's
private ClusterIP certificate. The registry issuer must use `spec.ca`, and that private CA
must be installed in the trust stores of every Kubernetes node and the machine running the CLI; the wizard requires
confirmation.
Install the CA on every node before installing Compartment. If you add it after the node container runtime starts,
restart the runtime so it reloads the trust store; run `systemctl restart k3s` on k3s servers and
`systemctl restart k3s-agent` on agent nodes. Node.js does not use the system CA store by default, so run the CLI with
`NODE_EXTRA_CA_CERTS=/path/to/ca.crt`. Alternatively, opt into the OpenSSL store with
`NODE_OPTIONS=--use-openssl-ca`.

For a clean k3s VM with Traefik and `local-path`, create a complete operator values file:

```yaml
ingress:
  className: traefik
tls:
  issuerRef:
    kind: ClusterIssuer
    name: letsencrypt-production
registry:
  issuerRef:
    kind: Issuer
    name: registry-ca
storage:
  storageClass: local-path
```

Then provide every non-interactive input explicitly. Set the password through the environment to keep it out of the
command arguments:

```bash
COMPARTMENT_ADMIN_PASSWORD='replace-with-a-strong-password' \
KUBECONFIG=./kubeconfig \
compartment install \
  --target kubernetes \
  --kube-context production \
  --namespace compartment \
  --release-name compartment \
  --base-domain apps.example.com \
  --email owner@example.com \
  --organization 'Example Company' \
  --values compartment-values.yaml
```

`storage.storageClass` may be empty when the cluster has one unambiguous default StorageClass. If public TLS uses an
existing Secret instead, replace `tls.issuerRef` and add the issuer used to create the private registry certificate.
A namespaced registry `Issuer` also belongs in the release namespace:

```yaml
ingress:
  className: traefik
tls:
  existingSecret: compartment-platform-tls
registry:
  issuerRef:
    kind: ClusterIssuer
    name: node-trusted-registry-ca
storage:
  storageClass: local-path
```

Use `--ingress-endpoint` only when the selected controller does not publish an address in Ingress status. It accepts
one IPv4 address, IPv6 address, or DNS hostname.

The preflight checks APIs, cert-manager, selected issuer trust hazards, ingress, storage, Helm ownership, namespace
policy labels, and permissions. As soon as the retained registry Service has a ClusterIP, installation derives the
registry identity from that IPv4 address. Installation stops with remediation instructions when the existing cluster
does not satisfy those requirements.

The command installs the matching bundled chart, creates the first owner, and saves the CLI session. If it stops
before owner creation, repair the reported cluster or Helm condition and retry with the same release coordinates and
unchanged intended values. Platform replacements are installed fresh in an empty namespace.

After owner creation has completed, rerunning the same command authenticates that original owner and returns a fresh
CLI session instead of attempting to initialize the installation again. The base domain, organization name and slug,
owner email, and owner password must still match the existing installation.

## Uninstall and reinstall

Helm uninstall removes the Compartment control plane. It does not delete project namespaces, tenant workloads, or
the retained platform state needed to reconnect them. To restore the control plane, reinstall with the same release
name and namespace. Treat those release coordinates as part of the retained installation identity; retained state is
not a portable backup for installing under a different release name or namespace.

Back up retained platform state and project data according to your storage provider's procedures before uninstalling.
Helm uninstall is not a project-data purge workflow.

## Public routing and TLS

The existing Ingress Controller owns public ports and TLS termination. Compartment creates exact console and
application host rules. It does not create catch-all routes or expose internal, health, registry, build, or operator
endpoints.

For an operator-owned system domain, set `tls.issuerRef` in the values file and run:

```bash
compartment system domain set --base-domain apps.example.com --values compartment-values.yaml
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

Publish every DNS and ownership record printed by `set`. The activation waits for the selected Ingress and
cert-manager Certificate to become ready.

An existing `kubernetes.io/tls` Secret may be referenced with `tls.existingSecret` when required by the ingress
contract. Compartment does not create or copy operator certificate material.

## Registry and builds

The bundled registry is private. Every project receives repository-scoped registry credentials and its own image pull
Secret. Nodes pull through the retained registry-auth Service IPv4 ClusterIP; Compartment does not edit node files or
restart node services.

The registry certificate carries that ClusterIP in its IP SAN, and its CA must be trusted by each node container
runtime. The installer pushes a unique acceptance image and asks every Ready node to pull it through the direct
Service address. Address mismatch, reachability, authentication, TLS, image-push, and node-pull failures are blocking.

Dockerfile and Railpack builds use an ephemeral BuildKit sidecar inside gVisor, push OCI images to the registry, and
deploy immutable digest-pinned references. Build cache is stored in the project/service registry repository; no
persistent cache volume is shared between tenants, and every Dockerfile or Railpack source deployment starts a fresh
build Job.

Docker Hub base images are fetched through a platform-owned pull-through cache. Its retained PVC defaults to `20Gi`;
set `storage.dockerHubCache` to a bounded size that fits the installation's base-image working set. For authenticated
Docker Hub pulls, set `dockerHubCache.credentials.existingSecret` to a Secret in the Compartment release namespace
with `username` and `password` keys. Do not put Docker Hub credentials in values files. BuildKit prefers the cache;
if it is unavailable or rejects a mirrored request, BuildKit falls back directly to Docker Hub so builds can continue.
Project NetworkPolicies preserve tenant isolation and the configured RFC1918 egress policy.

Kubernetes cluster administrators and anyone able to escape a container remain outside the tenant-isolation boundary.
Namespaces and NetworkPolicies do not provide VM-level isolation.

Compartment encrypts tenant variables before storing them in PostgreSQL, but projected Kubernetes Secrets are stored
by your cluster. Enable Kubernetes API server encryption at rest for Secrets on BYO clusters, and back up the
chart-managed tenant encryption key with the same care as the database.
For KEK rotation, stage the new 64-hex key in `secrets.tenantSecretsPreviousKek`, wait for the rollout, then promote the
same value to `secrets.tenantSecretsKek`. Clear the previous key only after a later migration run reports no remaining
re-wraps.

### Recover the bundled registry

With the default PVC backend, the registry is a single Pod with a retained `ReadWriteOnce` PVC. Running application
Pods continue during a registry outage, but builds, new deployments, and uncached image pulls do not. For a Pod
failure, preserve the configured storage and restart the Deployment:

```bash
kubectl --context <context> --namespace <namespace> \
  rollout restart deployment/<release>-compartment-registry
kubectl --context <context> --namespace <namespace> \
  rollout status deployment/<release>-compartment-registry --timeout=10m
```

For a default-backend PVC attachment or node loss, pause build and deploy activity, then restore the node or follow
the storage provider's detach/reattach procedure. If reattachment is impossible, restore a verified registry backup or
VolumeSnapshot into a replacement PVC with the same `<release>-compartment-registry` name, StorageClass, access mode,
and ownership. Do not delete the retained source PVC until the replacement passes integrity checks.

After recovery, verify the registry Deployment is Available and deploy a known revision to force a repository-scoped
fresh pull on every eligible node. If a manifest or blob is missing, keep builds paused and restore the last verified
backup; do not run garbage collection against a damaged store.

## Connect to an existing control plane

```bash
compartment login --api-url https://api.example.com
```

Use `compartment system status` to inspect the authenticated control plane and current organization.
For a provisioned VM, continue with [Operate a Managed VM](/guides/operate-managed-vm/) for updates, diagnostics,
recovery, and safe reprovisioning.

For either target, use [System Operations](/install-operate/system-operations/) for platform status, restart, update,
and install-domain commands.
