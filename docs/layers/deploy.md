# Deployment

## Owns

- `deploy/chart/compartment/`: installation-time platform Kubernetes resources.
- `deploy/e2e/`: isolated k3d lifecycle, image build/import, CLI-driven staged Helm installation, readiness checks, and benchmark fixtures.
- `scripts/deploy/prepare-worker-node-image.sh`: canonical worker-node K3s and gVisor image bootstrap.
- `scripts/deploy/worker-node-runtime-oom-e2e.sh`: disposable worker-node OOM and agent-restart runtime regression.

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

## Worker node image handoff

Run `pnpm worker-node:image:prepare` only on a pristine Ubuntu 24.04 image. A new instance joins exactly once with
`sudo compartment-worker-join <server-url> <token-file> <node-ip>`; the join command installs the token and starts
`k3s-agent`.

The runtime regression is deliberately fail-closed. On an isolated test worker, write its Kubernetes node name to
`/etc/compartment-disposable-runtime-test`, label that node
`compartment.dev/disposable-runtime-test=true`, export `KUBECONFIG` and `NODE_NAME`, then run
`pnpm worker-node:runtime:e2e`. Never add either marker to a production node.
