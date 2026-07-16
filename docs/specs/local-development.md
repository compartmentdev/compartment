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
