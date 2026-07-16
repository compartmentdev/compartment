# Compartment Helm chart

## Requirements

- Kubernetes 1.30.0 or newer. The chart uses the stable `admissionregistration.k8s.io/v1`
  `ValidatingAdmissionPolicy` API to confine project-bootstrap authority.
- Helm 4.x.

The chart declares its Kubernetes compatibility range in `Chart.yaml`; Helm rejects older clusters before rendering.

## Install

Use the chart from the same source release as the image tags you deploy. Set `platform.startupStage=full`; the
`foundation` stage exists only for workflows that must populate the bundled registry before starting the platform.

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

At minimum, decide and persist these values:

- `platform.baseDomain`, `platform.publicProtocol`, and `platform.tlsMode`;
- `service.caddy.type` and the external ingress or load-balancer configuration;
- `storage.storageClass` and the PVC sizes under `storage`;
- immutable tags for the platform images;
- the values under `secrets`, supplied through the installation's secret-management workflow.

The chart's Caddy Service is the only public entrypoint. It never routes `/internal/*`. Point both
`console.<baseDomain>` and `*.<baseDomain>` at that entrypoint.

## Node registry prerequisite

Application image references use the bundled registry host
`<release-fullname>-registry-auth.<namespace>.svc:5000`. Kubernetes nodes do not resolve Service DNS through cluster
DNS when their container runtime pulls images. Configure every node's container runtime with a mirror or equivalent
route to the bundled registry before deploying applications. This node-level configuration is outside Helm's scope.

The k3d e2e harness configures its k3s `registries.yaml` explicitly; use the corresponding mechanism for your
Kubernetes distribution.
