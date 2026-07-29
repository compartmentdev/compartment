---
title: Install Compartment
description: Install Compartment into an existing Kubernetes cluster.
---

## Install the CLI

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

This is the supported self-hosted installation channel. The bootstrap resolves an immutable CLI artifact for the
current Kubernetes release line and verifies its Cosign workflow identity and commit before installing it. No channel
flag, raw repository URL, or separate bootstrap step is required.

## Prepare the cluster

Compartment installs into an existing Kubernetes cluster. The initial supported release matrix is:

| Kubernetes distribution | Topology                 | Ingress Controller                                               | cert-manager |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- | ------------ |
| k3s v1.33.2+k3s1        | one server               | bundled Traefik v3.3.6                                           | v1.21.0      |
| k3s v1.33.2+k3s1        | one server and one agent | ingress-nginx controller v1.13.3, with Traefik v3.3.6 coexisting | v1.21.0      |

Versions or controllers outside this exact matrix are not supported until they are added to the release gate. The
CLI can preflight Kubernetes 1.30+ clusters, but a successful preflight does not expand the supported matrix.

Before installation, also provide:

- an Issuer or ClusterIssuer for operator-owned domains;
- NetworkPolicy enforcement;
- a persistent storage class;
- credentials permitted to install the Helm release and its cluster-scoped policy resources.

The installer does not install or disable an ingress controller, reserve node ports, or change node container-runtime
configuration.

Optional Helm values can assign platform, build, and tenant workloads to separately labeled and tainted nodes through
`nodePools.system`, `nodePools.build`, and `nodePools.tenant`. Leave all three pools empty for single-node clusters.
When pools are enabled, a pending platform Pod can preempt lower-priority tenant Pods that are eligible for the same
node. Priority does not guarantee availability during node failure or kubelet node-pressure eviction.

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

Compartment samples tenant CPU and memory usage every 60 seconds and retains hourly aggregates for 400 days by
default. Use `platform.usageMeteringIntervalMs` and `platform.usageRetentionDays` to tune collection overhead and
database retention. Missed samples are not reconstructed, and longer retention uses more database storage.

## Run the installer

Interactive installation discovers the cluster choices and prompts when more than one valid option exists:

```bash
compartment install --kubeconfig ./kubeconfig --kube-context production
```

For automation, provide the selections explicitly:

```bash
compartment install \
  --kubeconfig ./kubeconfig \
  --kube-context production \
  --namespace compartment \
  --release-name compartment \
  --ingress-class nginx \
  --storage-class fast \
  --values compartment-values.yaml
```

Use `--ingress-endpoint` only when the selected controller does not publish an address in Ingress status. It accepts
one IPv4 address, IPv6 address, or DNS hostname.

The preflight checks APIs, cert-manager, ingress, storage, Helm ownership, namespace policy labels, and permissions.
Installation stops with remediation instructions when the existing cluster does not satisfy those requirements.

The command installs the matching bundled chart, creates the first owner, and saves the CLI session. If it stops
before owner creation, repair the reported cluster or Helm condition and retry with the same release coordinates.

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
Secret. Nodes resolve the operator-provided private registry hostname through cluster infrastructure; Compartment
does not edit node files or restart node services.

Dockerfile and Railpack builds continue to use BuildKit and produce OCI images. Project NetworkPolicies preserve
tenant isolation and the configured RFC1918 egress policy.

Kubernetes cluster administrators and anyone able to escape a container remain outside the tenant-isolation boundary.
Namespaces and NetworkPolicies do not provide VM-level isolation.

### Recover the bundled registry

The registry is a single Pod with a retained `ReadWriteOnce` PVC. Running application Pods continue during a registry
outage, but builds, new deployments, and uncached image pulls do not. For a Pod failure, preserve the PVC and restart
the Deployment:

```bash
kubectl --context <context> --namespace <namespace> \
  rollout restart deployment/<release>-compartment-registry
kubectl --context <context> --namespace <namespace> \
  rollout status deployment/<release>-compartment-registry --timeout=10m
```

For a PVC attachment or node loss, pause build and deploy activity, then restore the node or follow the storage
provider's detach/reattach procedure. If reattachment is impossible, restore a verified registry backup or
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
