# Local Development

This document captures the local prerequisites and runtime behavior for repository-driven development.

## Prerequisites

```bash
brew install caddy
curl -sSL https://railpack.com/install.sh | sh
```

- `pnpm dev` expects `caddy`, `docker`, and `railpack` on `PATH`.
- `pnpm dev` uses the local `railpack` CLI to generate Railpack plans. Deploying source through the local worker also
  requires its configured Kubernetes context and build namespace; each deploy starts its own ephemeral BuildKit Job
  under the configured gVisor RuntimeClass.
- The `docker` CLI must reach a Docker-compatible daemon for the loopback artifact registry container.
- Local development uses env-configured PostgreSQL, not Docker-managed infra for the control plane.

## Local Runtime

```bash
pnpm dev
```

- `pnpm dev` starts the local `Caddy` ingress.
- Railpack plan generation calls the local `railpack` CLI; image assembly and push run in the deploy's Kubernetes
  BuildKit Job.
- The dev path also ensures a local bundled artifact registry container is running on loopback so deploy builds can push durable image refs for rollback and promote flows.
- The artifact registry container is development infrastructure, not an application runtime target.

## Local k3d E2E

Install `k3d`, `kubectl`, and Helm alongside the prerequisites above. For the managed-install shard, map
`console.managed.compartment.localhost` and `managed-domain-broker` to `127.0.0.1` in `/etc/hosts`.

Run one isolated shard at a time:

```bash
pnpm platform:e2e:run managed-install
pnpm platform:e2e:run user-flow
pnpm platform:e2e:run install-ha-network-policy
pnpm platform:e2e:run build-matrix-a-1
pnpm platform:e2e:run build-matrix-b-1
pnpm platform:e2e:run console
```

The runner builds the CLI and test images, creates shard-specific k3d and registry resources, and removes its cluster,
registry, builder cache, run-scoped images, volumes, network, and temporary state on success or failure. Shared `sha-*`
cache tags are retained for 24 hours so concurrent security scans keep stable inputs, then pruned on a later startup.
Failure diagnostics remain under `.compartment/platform-k3d-diagnostics-<shard>`.

To retain a failed stand for investigation, set `COMPARTMENT_E2E_KEEP_ON_FAILURE=1`. Successful runs always clean up.
CI uses the same opt-in through the `COMPARTMENT_E2E_KEEP_ON_FAILURE` Actions variable; leave it unset for the clean
default.

The shards use explicit reproducible k3s images. The `build-matrix-b-*` shards add one agent and ingress-nginx. All shards pin cert-manager and
leave bundled Traefik available. Controller plus cert-manager setup is measured once per cluster and must finish
within 120 seconds.
