---
title: Deploy using CLI
description: Deploy application code from a repository checkout into an existing Compartment install.
---

This guide is about deploying application code into an existing Compartment install.

The Compartment platform is installed separately. Here, you are deploying the apps that run on top of it.

Use it when your app can build into a container image and run inside Docker. That includes internal tools, admin panels, back offices, APIs, and apps produced by AI coding agents such as Codex as well as hand-written applications.

## Local checkout deploy flow

The default deploy path is CLI-first:

1. create or review the project descriptor;
2. optionally add route rules;
3. run `compartment deploy` from the repository checkout;
4. inspect the rollout and the live route.

## 1. Create the descriptor

If the repository does not already have a descriptor, start with:

```bash
compartment init
```

That writes a minimal `compartment.yml` and gives the project a canonical slug.

## 2. Review `compartment.yml`

`compartment.yml` is the main project descriptor. It defines the project name, services, and build or runtime hints.

Minimal example:

```yaml
name: internal-tools

services:
  web: .
```

## 3. Add `compartment.routes.yml` only when needed

You do not need `compartment.routes.yml` for the normal case.

Add it only when you want browser-facing rules such as:

- path-based routing across services;
- method filters;
- path rewrites before proxying upstream.

## 4. Deploy

From the repository root:

```bash
compartment deploy
```

Useful variants:

```bash
compartment deploy --env staging
compartment deploy --service web
compartment deploy --detach
compartment deploy --remote prod-eu --env production
```

Compartment uploads a source archive from your current checkout, reconciles any declared internal resources, builds the
selected service or services, and activates the deployment only after runtime checks pass.

Compartment validates that uploaded archive before it creates deployment records. If the archive is malformed, contains
invalid entry paths, omits or duplicates `.compartment/source-package.json`, or exceeds validation bounds, deploy fails
immediately with a validation error instead of queueing a rollout. The CLI creates this metadata for normal checkout
deploys; custom upload tooling must include it.

Selected, non-ignored archive entries must also be symlink-free. If the descriptor, `compartment.routes.yml`,
selected service paths, or included source paths resolve to symlinks, `compartment deploy` fails before rollout with a
path-specific validation error.

If `compartment.yml` declares top-level `resources`, deploy reconciles those Docker-backed resources before app services.
Inspect them with `compartment resource list`, `inspect`, and `logs`.

## Working across installs and environments

Compartment uses a `remote` to choose the logged-in install profile and `--env` to choose the deployment environment.

Use remotes when the same machine talks to more than one install:

```bash
compartment remote list
compartment remote use prod-eu
compartment status --remote prod-eu
```

Use `--env` when one repository deploys to more than one environment:

```bash
compartment deploy --env staging
compartment status --env production
```

The everyday deploy and inspect commands accept `--remote` and `--env`, including `deploy`, `status`, and `logs`.

`compartment deploy` resolves the install in this order:

1. `--remote`
2. the nearest repo binding from `.compartment/state.json`
3. the global current remote

If a repository has no saved binding and your machine has more than one configured remote, interactive
`compartment deploy` asks which remote to use and saves that choice in `.compartment/state.json`. In Git repositories,
the CLI also adds that state file to the nearest `.gitignore`. Non-interactive and JSON-output deploys fail instead of
guessing. Save a binding first with `compartment remote use <name>` or by accepting the binding prompt during
`compartment login`. Run `compartment remote use <name>` from a project directory to create a project override, or from
the Git root to change the repo-wide default.

## 5. Inspect the result

```bash
compartment status
compartment logs
compartment inspect
```

`status` and `inspect` show rollout state while the deployment is queued or running. The canonical app route appears there after the deployment completes successfully.

The live app route is derived from the project, environment, service, and install base domain.

## Git-backed deploy flow

If you want Compartment to connect a repository and optionally auto-deploy on pushes, use the Git source flow instead of deploying directly from your local checkout.

Automation note: `deploy`, `status`, `logs`, and `inspect` are contract-bound surfaces. Build scripts against the documented flags and named fields in the published CLI and API references instead of depending on undeclared response properties.

Next steps:

- Read [Deploy using Git](/deploy-apps/deploy-using-git/).
- Read [Deployment Lifecycle](/deploy-apps/deployment-lifecycle/).
- Read [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/).
