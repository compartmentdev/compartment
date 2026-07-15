# Compartment Helm chart

## Requirements

- Kubernetes 1.30.0 or newer. The chart uses the stable `admissionregistration.k8s.io/v1`
  `ValidatingAdmissionPolicy` API to confine project-bootstrap authority.
- Helm 4.x.

The chart declares its Kubernetes compatibility range in `Chart.yaml`; Helm rejects older clusters before rendering.
