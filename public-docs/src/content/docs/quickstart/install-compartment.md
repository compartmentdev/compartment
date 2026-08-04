---
title: Install Compartment
description: Install Compartment into an existing Kubernetes cluster.
---

## Install the CLI

```bash
curl -fsSL https://compartment.dev/k/install.sh | sh
```

This is the supported self-hosted installation channel. The bootstrap resolves an immutable CLI artifact for the
current Kubernetes release line and verifies its Cosign workflow identity and commit before installing it. No channel
flag, raw repository URL, or separate bootstrap step is required. The public route returns a 307 redirect to the
Kubernetes branch's root installer, which is the sole source of truth.

The default command follows the tip of the `kubernetes` channel. To reproduce an installation with a specific
published build, pin its full immutable tag:

```bash
curl -fsSL https://compartment.dev/k/install.sh | sh -s -- \
  --channel kubernetes \
  --version sha-0123456789abcdef0123456789abcdef01234567
```

`--channel` selects where the installer resolves artifacts (`latest`, `main`, or `kubernetes`), while `--version`
selects an exact tag within that channel. Kubernetes pins must use `sha-` followed by the full 40-character lowercase
commit SHA. The installer verifies the pinned artifact with the same digest and Cosign identity checks as the channel
tip. If a new Kubernetes tip is still publishing, the installer prints a copyable command for the latest fully
published and signed build after verifying it. If automatic discovery is unavailable, it links the successful
publication runs and prints the command template to complete with that run's full commit SHA.

## Prepare the cluster

Compartment installs into an existing Kubernetes cluster. The initial supported release matrix is:

| Kubernetes distribution | Topology                 | Ingress Controller                                               | cert-manager |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- | ------------ |
| k3s v1.33.2+k3s1        | one server               | bundled Traefik v3.3.6                                           | v1.21.0      |
| k3s v1.33.2+k3s1        | one server and one agent | ingress-nginx controller v1.13.3, with Traefik v3.3.6 coexisting | v1.21.0      |

Versions or controllers outside this exact matrix are not supported until they are added to the release gate. The
CLI can preflight Kubernetes 1.30+ clusters, but a successful preflight does not expand the supported matrix.

Before installation, also provide:

- `helm` 4.0.0 or newer on `PATH` (`helm version --short`);
- `kubectl` 1.30.0 or newer on `PATH`, compatible with the target Kubernetes server (`kubectl version --client`);
- an Issuer or ClusterIssuer for operator-owned public domains;
- a separate cert-manager CA Issuer or ClusterIssuer for the private registry, with its CA already trusted by every
  node container runtime and the machine running the CLI;
- NetworkPolicy enforcement;
- a persistent storage class;
- credentials permitted to install the Helm release and its cluster-scoped policy resources.

The installer does not install or disable an ingress controller, reserve node ports, or change node container-runtime
configuration.

The private registry uses its retained Service ClusterIP directly. The installer derives this address after the
foundation stage and requests a Certificate with the address in its IP SAN. It does not require registry DNS or
modify node host/runtime configuration. Public ACME issuers cannot issue this private IP certificate; configure
`registry.issuerRef` with the node-trusted CA issuer. Reinstalling recomputes the address and registry Certificate.

Optional Helm values can assign platform, build, and tenant workloads to separately labeled and tainted nodes through
`nodePools.system`, `nodePools.build`, and `nodePools.tenant`. Leave all three pools empty for single-node clusters.
When pools are enabled, a pending platform Pod can preempt lower-priority tenant Pods that are eligible for the same
node. Priority does not guarantee availability during node failure or kubelet node-pressure eviction.

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
```

An empty build pool uses the system pool. Pass the file to `compartment install` with `--values
compartment-values.yaml`.

Build isolation uses a private Kubernetes user namespace, writable `emptyDir` state, credentials, network policy, and
process sandbox for every BuildKit Job. A gVisor RuntimeClass adds a separate kernel boundary when `runsc` and the
matching containerd runtime handler are installed on every eligible build node. Compartment can create that
RuntimeClass, but it does not install runtimes or change node containerd configuration. Configure build and tenant
kernel sandboxing separately:

```yaml
buildkit:
  runtimeClassName: gvisor
  createRuntimeClass: true
  runtimeHandler: runsc

tenantRuntime:
  runtimeClassName: gvisor
  createRuntimeClass: true
  runtimeHandler: runsc
```

Set the matching `createRuntimeClass` value to `false` when the cluster operator manages the `gvisor` RuntimeClass
separately. The tenant sandbox
covers application and stateful resource Pods plus product and provisioning Jobs. Platform Pods, `api-migrate`, and
control-plane workloads keep the node default runtime. Each build Job is deleted after completion.

Compartment samples tenant CPU and memory usage every 60 seconds and retains hourly aggregates for 400 days by
default. The metering interval also controls hosted application traffic flushes. Use
`platform.usageMeteringIntervalMs` and `platform.usageRetentionDays` to tune collection overhead and database
retention. Missed samples and unflushed edge traffic are not reconstructed, and longer retention uses more database
storage.

## Run the installer

Interactive installation discovers the cluster choices and prompts when more than one valid option exists:

```bash
KUBECONFIG=./kubeconfig compartment install --kube-context production
```

The managed Compartment domain is the default public-domain choice and requires no prior domain preparation. The
installer allocates the domain with the discovered IPv4 or IPv6 Ingress endpoint, retains the returned acme-dns token,
and waits for the resulting Certificates to become ready. If the Ingress endpoint is a hostname, managed domains are
unavailable because the broker publishes only A/AAAA records. The installer does not resolve cloud load-balancer
hostnames into unstable IPs; choose an operator-owned base domain instead. Both domain modes still require the
node-trusted registry CA issuer described below.

When you select an operator-owned base domain, the wizard also asks how public TLS is provided. Choose an existing
cert-manager `Issuer` or `ClusterIssuer`, or choose an existing `kubernetes.io/tls` Secret. The Secret option also asks
for an issuer for the private registry certificate. A namespaced `Issuer` or Secret must exist in the release namespace
(`--namespace`, default `compartment`); a `ClusterIssuer` is cluster-scoped. Create the namespace first when you use
namespaced certificate resources.

Do not select an issuer with `spec.selfSigned`. A public ACME issuer is appropriate for operator-owned public TLS but
cannot issue the registry's private ClusterIP certificate. The registry issuer must use `spec.ca`, and that private CA
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
storage:
  storageClass: local-path
```

Then provide every non-interactive input explicitly. Set the password through the environment to keep it out of the
command arguments:

```bash
COMPARTMENT_ADMIN_PASSWORD='replace-with-a-strong-password' \
KUBECONFIG=./kubeconfig \
compartment install \
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

Dockerfile and Railpack builds use an ephemeral BuildKit sidecar whose root process is mapped into a private Kubernetes
user namespace. BuildKit keeps process sandboxing enabled and produces OCI images. Build cache is stored in the
project/service registry repository; no persistent cache volume is shared between tenants. An optional configured
`buildkit.runtimeClassName` can add a gVisor kernel boundary. Project NetworkPolicies preserve tenant isolation and the configured
RFC1918 egress policy.

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
