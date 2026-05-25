---
title: Deploy using Git
description: Connect a repository so Compartment can map branches to environments and optionally auto-deploy on push.
---

Use the Git flow when you want Compartment to keep a repository connected to the install instead of deploying only from a local checkout.

This is useful when:

- you want repeatable deploys from a shared branch;
- you run a monorepo with multiple `compartment.yml` files;
- you want push-driven deploys for a selected environment.

## How it works

`compartment source connect git` uses the current repository checkout as GitHub defaults, then asks which GitHub account, repository, branch, and environment to connect.

You can also connect Git from the Console install-time first-deploy setup or later from **Projects** -> **Deploy my first project** or **Add project**. The Console path is useful for first-time setup because it can guide GitHub App setup, repository selection, descriptor pull request creation, and the first deployment in one flow. For newly connected sources, the Console enables automatic descriptor adoption and automatic deploys for the selected branch and environment.

When the selected repository has no `compartment.yml` and does not already look like an application repository, the Console can propose a starter pull request instead of a descriptor-only pull request. That PR adds the descriptor and a minimal `apps/site/index.html` so the repository becomes deployable immediately.

If GitHub App access is missing, the command opens a browser setup URL and waits. In GitHub, choose the repositories the Compartment GitHub App can access.

Each connected Git source also gets a system-managed automation account. Compartment uses that account for source sync and push-driven deploy work. It can appear in the browser or CLI user list as an automation entry, but it is not a human login account.

When a connected descriptor declares top-level `resources`, push-driven deploys reconcile those internal Docker-backed
resources from the same `compartment.yml` before deploying app services.

## Connect the repository

Run this from the repository checkout you want to connect:

```bash
compartment source connect git
```

Common variants:

```bash
compartment source connect git --all
compartment source connect git --branch main --env production --auto-deploy
compartment source connect git --branch develop --env staging --manual
compartment source connect git --all --auto-adopt-new-apps enabled
```

What the command asks for:

- the GitHub account, repository, and branch to watch;
- the target environment;
- whether newly discovered descriptor apps should be adopted automatically;
- whether pushes should auto-deploy.

## What gets connected

Each binding maps:

- one repository;
- one descriptor path;
- one branch;
- one environment;
- one project name from `compartment.yml`.

The project name `create` is reserved for the Console create-project route, so connected descriptors must use a different project slug.

In a monorepo, `--all` enables automatic adoption for discovered descriptor apps instead of asking the adoption question.

## Auto deploy and manual mode

With `--auto-deploy`, pushes on the mapped branch queue deployments automatically for the bound descriptor.

With `--manual`, the source stays connected, but pushes do not trigger deployments automatically.

Push-driven deploys use the same source-archive rules as `compartment deploy`: selected, non-ignored archive entries
must stay symlink-free, including the descriptor, routes file, selected service paths, and `build.include` paths.
Ignored symlinked paths are skipped. Unrelated symlinks elsewhere in the repository do not block the binding.

## Keep connected sources in sync

After the repository structure changes, or when you want Compartment to rediscover descriptor apps in the connected repository, run:

```bash
compartment source sync <sourceId>
```

Use source settings when you want newly discovered apps to be adopted automatically:

```bash
compartment source settings get <sourceId>
compartment source settings set <sourceId> --auto-adopt-new-apps enabled
```

When adoption is disabled, new descriptor apps stay visible in sync results but do not become managed apps until you include or connect them explicitly.

## Inspect or disconnect sources

```bash
compartment source list
compartment source show <sourceId>
compartment source sync <sourceId>
compartment source exclude <sourceId> <descriptorPath>
compartment source include <sourceId> <descriptorPath>
compartment source disconnect <sourceId>
```

When you manage more than one install, the source commands also accept `--remote <name>`.

Disconnecting or disabling a source also disables that source automation account. Reconnecting or re-enabling the source restores it automatically.

Automation note: `source list`, `show`, `settings`, `sync`, `exclude`, `include`, and `disconnect` are contract-bound surfaces. Use the generated `source` command reference for supported flags and rely only on documented output fields.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/).
- Browse the [generated source command reference](/reference/generated/cli/source/).
