# Existing Kubernetes installation prerequisites

This guide prepares an existing Kubernetes cluster for `compartment install`. Compartment does not install, upgrade,
or remove Kubernetes, an Ingress Controller, cert-manager, a CNI, or a StorageClass.

## Supported installation channel

The existing-Kubernetes installer is the supported self-hosted installation channel. The public bootstrap at
`https://compartment.dev/k/install.sh` redirects to the root installer on the `kubernetes` branch. That installer
resolves the current branch commit and matching immutable CLI OCI artifact by digest, then verifies its Cosign
identity, OIDC issuer, and workflow commit before pulling it. No channel flag or raw branch URL is required.

The supported test matrix uses five isolated k3d shards. Every shard owns one cluster and installs its selected
Ingress Controller and pinned cert-manager prerequisite once:

- `managed-install`: managed DNS, TLS, first-owner installation, and retained-stage retry;
- `build-matrix-a`: install, NetworkPolicy enforcement, Dockerfile builds, registry push and node pull, rollout, and
  image lifecycle;
- `build-matrix-b`: a two-node ingress-nginx cluster, with the existing Traefik controller left available, plus
  install, Railpack, and static build variants;
- `user-flow`: install plus authenticated CLI, organization, project, domain, promote, and rollback flows;
- `console`: install plus Console, G1 isolation, private-route denial, and product-log gates.

Ingress Controller plus cert-manager setup has a 120-second wall-time budget in every shard. The lifecycle harness
measures and enforces that budget, and the shard owner is the suite named above. A shard reuses the same prerequisite
installation for all of its scenarios.

The initial supported release matrix is exact:

| Kubernetes distribution | Topology                 | Ingress Controller                                               | cert-manager |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- | ------------ |
| k3s v1.33.2+k3s1        | one server               | bundled Traefik v3.3.6                                           | v1.21.0      |
| k3s v1.33.2+k3s1        | one server and one agent | ingress-nginx controller v1.13.3, with Traefik v3.3.6 coexisting | v1.21.0      |

Versions or controllers outside this matrix are not part of the supported channel until they are added to the
release gate. The CLI may accept other Kubernetes 1.30+ clusters during preflight, but that does not expand this
published compatibility matrix.

## Required cluster capabilities

Provide a cluster from the supported matrix, a working kube context, the listed installed and ready Ingress
Controller with an IngressClass, cert-manager v1.21.0 with its CRDs and controller components ready, a usable
StorageClass, and a CNI that enforces the NetworkPolicy features used by Compartment.

Nodes must resolve the private A record for the Compartment registry zone. If a node resolver blocks DNS rebinding or
public names that resolve to private addresses, the operator must allowlist that registry zone. For dnsmasq, configure
`rebind-domain-ok` for the exact zone; use the equivalent scoped allowlist for other resolvers.

Kube-proxy-based Service routing is required on every node. Kube-proxy-less Cilium is not supported.

The installer checks API reachability and version, required APIs and permissions, release ownership, IngressClass and
StorageClass selection, cert-manager APIs and readiness, Certificate admission by server-side dry-run, Ingress host
ownership, retained installation identity, and published image signatures. These checks do not create namespaces,
Pods, Certificates, Secrets, or other persistent cluster objects.

## Bare-VM test quickstart

Use this sequence only for a clean test VM:

```bash
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl apply \
  -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml
sudo k3s kubectl --namespace cert-manager wait deployment --all \
  --for=condition=Available --timeout=5m
```

Make the k3s kube context available to the CLI, then run:

```bash
compartment install
```

The default domain choice is a managed Compartment domain. It is reserved directly during installation with no prior
setup, then bound to the Ingress endpoint discovered by the installer. Select an operator-owned domain only when you
want to provide its DNS and certificate configuration yourself.

Default k3s supplies Traefik, ServiceLB, Flannel, its NetworkPolicy controller, CoreDNS, and the `local-path`
StorageClass. The pinned cert-manager manifest supplies the Certificate APIs, controller, webhook, and cainjector.
Compartment does not own their lifecycle.

If preflight reports a missing or unready cert-manager component, repair that component or reapply the pinned
v1.21.0 manifest before retrying. Preflight names the failed component and repeats the pinned command.
