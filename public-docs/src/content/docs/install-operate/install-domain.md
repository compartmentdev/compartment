---
title: Install Domain
description: Choose the public domain and TLS ownership model for a Compartment Kubernetes installation.
---

Every Compartment installation has one base domain. The Console and canonical application routes are published under
that domain. This install domain is separate from any [custom domain added to one app](/deploy-apps/custom-domains-for-apps/).

The installer supports two domain ownership models on both managed-VM and existing-Kubernetes targets.

In an interactive install, both targets show the same domain choice. A managed-VM install carries that choice into
the canonical Kubernetes install without asking for issuer kind or name; its internal registry PKI and node trust
and its gVisor/runsc runtime are automatic.

## Managed Compartment domain

The managed domain is the default when you do not pass `--base-domain`. The installer allocates the domain, retains
its broker credentials, publishes the discovered Ingress IP through A or AAAA records, and waits for the platform
certificates to become ready.

Select it explicitly for automation:

```bash
compartment install --target kubernetes --managed-domain --kube-context production
```

Managed domains require the selected Ingress to publish an IPv4 or IPv6 address. They are unavailable when Ingress
status contains only a hostname because the broker does not resolve cloud load-balancer hostnames into unstable IP
addresses.

## Operator-owned domain

Pass your own base domain when you control its DNS and public TLS:

```bash
compartment install \
  --target kubernetes \
  --kube-context production \
  --base-domain apps.example.com
```

The interactive installer offers two public TLS paths:

- terminate TLS outside Compartment and forward HTTP to the platform;
- use an existing `kubernetes.io/tls` Secret in the Compartment namespace.

Publish the DNS records reported by the installer. A namespaced Secret or `Issuer` must exist in the installation
namespace; a `ClusterIssuer` is cluster-scoped.

The bundled private registry has a separate certificate for its retained Service IP. On an existing cluster, its
`registry.issuerRef` must reference a cert-manager CA issuer whose CA is already trusted by every eligible Kubernetes
node and by the machine running the CLI. A public ACME issuer and a self-signed issuer do not satisfy this registry
trust requirement.

The existing-Kubernetes installer discovers `Issuer` resources in the installation namespace and `ClusterIssuer`
resources cluster-wide. You select one of those exact resources, with the first discovered choice as the displayed
default. If the cert-manager CRDs or all issuers are absent, install cert-manager and create a CA issuer whose CA is
trusted by every eligible node and the CLI machine, then rerun the installer. The CLI prints the pinned cert-manager
install and issuer discovery commands when either prerequisite is absent. Compartment does not create the issuer or
distribute CA trust on an existing cluster.

## Change an existing install domain

Stage, verify, and activate an operator-owned domain with the same values used for the installation:

```bash
compartment system domain set --base-domain apps.example.com --values compartment-values.yaml
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

Activation waits for the selected Ingress and certificate resources. It does not expose internal services or health
routes.

Next steps:

- Follow [Install Compartment](/quickstart/install-compartment/) for complete values and trust examples.
- Read [System Operations](/install-operate/system-operations/).
- Add app-specific hosts with [Custom Domains for Apps](/deploy-apps/custom-domains-for-apps/).
