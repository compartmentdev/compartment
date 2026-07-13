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

`compartment source connect git` uses the current repository checkout, detects the provider, then asks which repository owner or namespace, repository, branch, and environment to connect. The Console onboarding starts with a GitHub/GitLab provider choice.

You can also connect Git from the Console install-time first-deploy setup or later from **Projects** -> **Deploy my first project** or **Add project**. Choose GitHub to install or authorize the Compartment GitHub App; choose GitLab to enter a GitLab host and access token. The Console guides provider setup, repository selection, descriptor pull request or merge request creation, and the first deployment in one flow. For newly connected sources, the Console enables automatic descriptor adoption and automatic deploys for the selected branch and environment.

When the selected repository has no `compartment.yml` and does not already look like an application repository, the Console can propose a starter pull request (GitHub) or merge request (GitLab) instead of a descriptor-only change. That change adds the descriptor and a minimal `apps/site/index.html` so the repository becomes deployable immediately.

If GitHub App access is missing, the command opens a browser setup URL and waits. In GitHub, choose the repositories the Compartment GitHub App can access. For GitLab, the CLI uses `COMPARTMENT_GITLAB_TOKEN` when a token-based registration is needed; the Console asks for the same token directly.

## GitLab requirements

Use a GitLab token with the `api` scope and Maintainer access. Maintainer access is required to create the source webhook, and the repository picker only lists projects where the token has at least Maintainer-level access.

For self-managed GitLab, enter the GitLab host in the Console and add that host to `COMPARTMENT_TRUSTED_OUTBOUND_HOSTS` for both the API and worker services. Re-submit the GitLab form to rotate a token; the existing registration is rotated in place and its webhook remains connected. If a token is revoked, deployments fail with a request to re-enter the GitLab token and the Console shows **Re-enter token**.

The CLI provider detection matrix is:

- `github.com` -> GitHub;
- `gitlab.com` -> GitLab;
- a host with an active GitLab registration -> GitLab;
- a token set and the host not active for GitHub -> GitLab;
- otherwise -> GitHub.

Each connected Git source also gets a system-managed automation account. Compartment uses that account for source sync and push-driven deploy work. It does not appear on the browser Users page, but CLI and API user lists can still return it as an automation entry. It is not a human login account.

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

- the repository owner or namespace, repository, and branch to watch;
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
