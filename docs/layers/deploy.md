# Deployment

## Owns

- `deploy/chart/compartment/`: installation-time platform Kubernetes resources.
- `deploy/e2e/`: isolated k3d lifecycle, image build/import, CLI-driven staged Helm installation, readiness checks, and benchmark fixtures.

## Must not

- duplicate application workload projection or worker build orchestration;
- expose BuildKit, the registry, internal-token routes, or control-plane health routes through public ingress;
- depend on the current Kubernetes context or commit generated credentials and cluster state.

The chart consumes installation-verified sandbox RuntimeClasses for tenant scheduling and builds and owns the
build-namespace network policy. Tenant workloads use the shared-file-access class. Builds use a separate
exclusive-file-access class so the read-only BuildKit seed can be traversed without per-access revalidation. The CLI
owns runtime verification, managed-node runtime installation, and migration of existing managed installations before
the worker is upgraded. During upgrades, the chart renders only matching RuntimeClasses already owned by the same
Helm release, marks them retained, and otherwise never adopts operator- or CLI-owned RuntimeClasses.
The worker submits each ephemeral build through the runtime package's `runJob`
primitive; the runtime package continues to own Kubernetes transport and
application workload reconciliation.
