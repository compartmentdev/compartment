---
title: Install Compartment
description: Install Compartment into an existing Kubernetes cluster.
---

## Install the CLI

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

## Prepare the cluster

Compartment installs into an existing Kubernetes cluster. Before installation, provide:

- Kubernetes 1.30 or newer;
- an enabled Ingress Controller and one IngressClass;
- cert-manager and an Issuer or ClusterIssuer for operator-owned domains;
- NetworkPolicy enforcement;
- a persistent storage class;
- credentials permitted to install the Helm release and its cluster-scoped policy resources.

The installer does not install or disable an ingress controller, reserve node ports, or change node container-runtime
configuration.

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
  --storage-class fast
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

## Connect to an existing control plane

```bash
compartment login --api-url https://api.example.com
```

Use `compartment system status` to inspect the authenticated control plane and current organization.
