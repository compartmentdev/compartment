# Deployment

## Owns

- `deploy/chart/compartment/`: installation-time platform Kubernetes resources.
- `deploy/e2e/`: isolated k3d lifecycle, image build/import, CLI-driven staged Helm installation, readiness checks, and benchmark fixtures.

## Must not

- duplicate application workload projection or worker build orchestration;
- expose BuildKit, the registry, internal-token routes, or control-plane health routes through public ingress;
- depend on the current Kubernetes context or commit generated credentials and cluster state.

The chart consumes one installation-verified sandbox RuntimeClass for build and tenant scheduling and owns the
build-namespace network policy. The CLI owns runtime verification and managed-node runtime installation.
During upgrades, the chart renders only a matching RuntimeClass already owned by the same Helm release, marks it
retained, and otherwise never adopts an operator- or CLI-owned RuntimeClass.
The worker submits each ephemeral build through the runtime package's `runJob`
primitive; the runtime package continues to own Kubernetes transport and
application workload reconciliation.
