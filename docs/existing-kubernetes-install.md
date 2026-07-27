# Existing Kubernetes installation prerequisites

This guide prepares an existing Kubernetes cluster for `compartment install`. Compartment does not install, upgrade,
or remove Kubernetes, an Ingress Controller, cert-manager, a CNI, or a StorageClass.

## Required cluster capabilities

Provide Kubernetes 1.30 or newer, a working kube context, an installed and ready Ingress Controller with an
IngressClass, cert-manager v1.21.0 with its CRDs and controller components ready, a usable StorageClass, and a CNI that
enforces the NetworkPolicy features used by Compartment.

Nodes must resolve the private A record for the Compartment registry zone. If a node resolver blocks DNS rebinding or
public names that resolve to private addresses, the operator must allowlist that registry zone. For dnsmasq, configure
`rebind-domain-ok` for the exact zone; use the equivalent scoped allowlist for other resolvers.

Kube-proxy-based Service routing is required on every node. Kube-proxy-less Cilium is not supported. The
[registry node-pull proof](./proofs/registry-node-pull.md) records why this is a prerequisite rather than an installer
probe.

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

Default k3s supplies Traefik, ServiceLB, Flannel, its NetworkPolicy controller, CoreDNS, and the `local-path`
StorageClass. The pinned cert-manager manifest supplies the Certificate APIs, controller, webhook, and cainjector.
Compartment does not own their lifecycle.

If preflight reports a missing or unready cert-manager component, repair that component or reapply the pinned
v1.21.0 manifest before retrying. Preflight names the failed component and repeats the pinned command.
