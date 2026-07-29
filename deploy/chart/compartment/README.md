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

## Public ingress

Set `ingress.className` to the selected existing IngressClass. When that controller does not publish Ingress status,
set `ingress.endpoint.type` to `A`, `AAAA`, or `hostname` and provide `ingress.endpoint.value`. The installer persists
the equivalent typed targets in `ingress.targetsJson`.

The chart renders exact console and application host rules with no catch-all host, default backend, or
controller-specific annotation. Caddy is reachable only through a ClusterIP Service on the internal HTTP port. Its
NetworkPolicy admits that port from cluster ingress sources.

## TLS

Managed-domain installations use the bundled allocation-scoped DNS-01 solver. For an operator-owned domain, set
`tls.issuerRef.name` and `tls.issuerRef.kind` to an existing Issuer or ClusterIssuer. `tls.existingSecret` may reference
an existing `kubernetes.io/tls` Secret.

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

Project provisioning creates repository-scoped credentials and project-scoped image pull Secrets. NetworkPolicy
projections retain tenant isolation and the configured RFC1918 egress policy. Dockerfile, Railpack, BuildKit, and OCI
image behavior is unchanged.
