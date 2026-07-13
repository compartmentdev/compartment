# Deployment

## Owns

- `deploy/chart/compartment/`: installation-time platform Kubernetes resources.
- `deploy/e2e/`: isolated k3d lifecycle, image build/import, staged Helm installation, readiness checks, and benchmark fixtures.

## Must not

- duplicate application workload projection or worker build orchestration;
- expose BuildKit, the registry, internal-token routes, or control-plane health routes through public ingress;
- depend on the current Kubernetes context or commit generated credentials and cluster state.

The chart is the sole owner of installation-time BuildKit deployment, pruning,
storage, and network policy. The runtime package continues to own application
workload reconciliation.
