# Local Development

This document captures the local prerequisites and runtime behavior for repository-driven development.

## Prerequisites

```bash
brew install caddy buildkit
curl -sSL https://railpack.com/install.sh | sh
```

- `pnpm dev` expects `caddy`, `buildctl`, `docker`, and `railpack` on `PATH`.
- Source builds require `BUILDKIT_ADDR` to point at a reachable BuildKit daemon.
- The `docker` CLI must reach a Docker-compatible daemon for the loopback artifact registry container.
- Local development uses env-configured PostgreSQL, not Docker-managed infra for the control plane.

## Local Runtime

```bash
pnpm dev
```

- `pnpm dev` starts the local `Caddy` ingress.
- Source builds call the local `railpack` CLI.
- The dev path also ensures a local bundled artifact registry container is running on loopback so deploy builds can push durable image refs for rollback and promote flows.
- The artifact registry container is development infrastructure, not an application runtime target.

## Local k3d E2E

Install `k3d`, `kubectl`, and Helm alongside the prerequisites above. For the managed-install shard, map
`console.managed.compartment.localhost` and `managed-domain-broker` to `127.0.0.1` in `/etc/hosts`.

Run one isolated shard at a time:

```bash
pnpm platform:e2e:run managed-install
pnpm platform:e2e:run user-flow
pnpm platform:e2e:run build-matrix-a
pnpm platform:e2e:run build-matrix-b
pnpm platform:e2e:run console
```

The runner builds the CLI and test images, creates shard-specific k3d and registry resources, and removes its cluster,
registry, builder cache, run-scoped images, volumes, network, and temporary state on success or failure. Shared `sha-*`
cache tags are retained for 24 hours so concurrent security scans keep stable inputs, then pruned on a later startup.
Failure diagnostics remain under `.compartment/platform-k3d-diagnostics-<shard>`.

To retain a failed stand for investigation, set `COMPARTMENT_E2E_KEEP_ON_FAILURE=1`. Successful runs always clean up.
CI uses the same opt-in through the `COMPARTMENT_E2E_KEEP_ON_FAILURE` Actions variable; leave it unset for the clean
default.

All shards pin k3s v1.33.2+k3s1 and cert-manager v1.21.0. `build-matrix-b` adds one agent and pins ingress-nginx
controller v1.13.3 while leaving bundled Traefik v3.3.6 available; the other shards use bundled Traefik. Controller
plus cert-manager setup is measured once per cluster and must finish within 120 seconds.
