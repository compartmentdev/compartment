<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/compartment-logo-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/compartment-logo-black.svg" />
    <img src=".github/assets/compartment-logo-black.svg" alt="Compartment" width="360" />
  </picture>
</p>

<h1 align="center">Compartment</h1>

<p align="center">
  Self-hosted deployment infrastructure for internal tools, private apps, and public services.
</p>

<p align="center">
  <a href="https://docs.compartment.dev/">Docs</a>
  ·
  <a href="#quickstart">Quickstart</a>
  ·
  <a href="#developing-locally">Developing locally</a>
  ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/compartmentdev/compartment/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/compartmentdev/compartment/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="./LICENSE">
    <img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" />
  </a>
</p>

## What Is Compartment?

Compartment is a self-hosted deployment system for teams that need a controlled place to run software on their own infrastructure. It provides the runtime, URLs, access model, deployment history, and operations surface around applications that already live in normal repositories.

The project is CLI-first and repository-first. Add a `compartment.yml`, deploy from a checkout or connected Git repository, and run the result through a self-hosted control plane. If an app can build into a container image with Docker or [Railpack](https://railpack.com/), it can usually fit the Compartment model.

## Why Teams Use It

Teams use Compartment when software that started as a script, internal app, worker, or AI-generated tool becomes useful enough that it needs a stable place to run.

- Share team software without ad hoc links, manual handoffs, or unclear ownership.
- Keep runtime control on infrastructure the team owns, without turning sustained compute or traffic into managed-platform spend.
- Govern access with SSO, RBAC, roles, and audit logs instead of informal permission paths.
- Run tools close to private services, data stores, and internal APIs while keeping workloads isolated.
- Move from repository code to a working app without building a custom platform stack first.

## Quickstart

Install the CLI, then create the Compartment system on the target server:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
compartment install
```

If you are already on the target server and want one command:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install
```

Prepare an application repository:

```bash
compartment init
```

The smallest descriptor looks like this:

```yaml
name: internal-tools

services:
  web: .
```

Deploy and inspect the result:

```bash
compartment deploy
compartment status
compartment logs
```

For branch-driven deploys, connect the repository through the Console or with `compartment source connect git`. See [Deploy using Git](https://docs.compartment.dev/deploy-apps/deploy-using-git/) for the full flow.

## Repository Layout

| Path                 | Purpose                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `packages/cli`       | User-facing `compartment` command implementation.                               |
| `packages/sdk`       | SDK client surface used by the CLI and other clients.                           |
| `packages/contracts` | Shared public contracts, schemas, paths, and generated reference inputs.        |
| `packages/api`       | Control-plane API, auth, persistence, migrations, and server-owned web serving. |
| `packages/console`   | Vite and React browser control plane.                                           |
| `packages/worker`    | Deployment execution and background work.                                       |
| `packages/node`      | Runtime-node control surface for deployed services.                             |
| `packages/edge`      | Hosted-app ingress and access enforcement boundary.                             |
| `public-docs`        | Public Starlight documentation site.                                            |
| `docs`               | Internal architecture, package ownership, and operating specs.                  |
| `examples`           | Example applications and descriptor fixtures.                                   |

## Developing Locally

Use the Node version pinned in `.nvmrc` and the pnpm version declared in `package.json`.

```bash
nvm use
pnpm install
cp .env.example .env
```

Local development expects PostgreSQL from `COMPARTMENT_DATABASE_URL`, plus `caddy` and `railpack` on `PATH`:

```bash
brew install caddy
curl -sSL https://railpack.com/install.sh | sh
pnpm dev
```

Read [docs/specs/local-development.md](./docs/specs/local-development.md) before changing local runtime behavior.

## Contributing

Start with [CONTRIBUTING.md](./CONTRIBUTING.md). The short version:

- Keep changes package-owned and scoped to one behavior.
- Start new product behavior from the CLI command and shared SDK/API contract.
- Read the relevant file under [docs/layers](./docs/layers/) before editing a package.
- Update public docs when shipped user-visible behavior changes.
- Run the narrowest relevant lint, typecheck, and test commands for the package you touched.

## Useful Links

- [Homepage](https://compartment.dev/)
- [Documentation](https://docs.compartment.dev/)
- [Docker Hub](https://hub.docker.com/orgs/compartmentdev)

## License

Compartment is licensed under the [Apache License 2.0](./LICENSE).
