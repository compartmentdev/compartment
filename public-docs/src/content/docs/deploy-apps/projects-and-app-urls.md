---
title: Projects and App URLs
description: Understand project identity, remote project records, and how Compartment forms canonical app URLs.
---

Compartment derives the canonical project slug from `compartment.yml`, but it also keeps a remote project record for lifecycle and routing state.

## How the app URL is formed

Compartment derives the canonical host from the project name, environment, service, and install base domain:

- primary `web` service in `production`: `<project>.<baseDomain>`
- primary `web` service outside `production`: `<project>-<environment>.<baseDomain>`
- non-`web` service in `production`: `<service>-<project>.<baseDomain>`
- non-`web` service outside `production`: `<service>-<project>-<environment>.<baseDomain>`

This is the default route family before you add any custom domains.

Use:

```bash
compartment project list
compartment project show
compartment project rename
compartment project archive --yes
compartment project unarchive
compartment project delete --project <slug> --yes
```

`project list` is the best overview command when you want to see active project state and the currently reported route URL.

Open the browser control plane at `/`. Compartment redirects from that landing page into the selected organization's Projects page, which stays the main browser table for project inspection and navigation.

Project pages are scoped by organization in the browser URL. For example, the Projects page for the `acme-dev` organization is `/orgs/acme-dev/projects`, and the project overview for `billing` is `/orgs/acme-dev/projects/billing`.

The Projects table also exposes an `Open` action for live public routes. The primary `Open` target uses the project's canonical public route and prefers the browser-facing app entrypoint over API-style routes when a project exposes multiple live public targets. The browser also shows a menu so you can choose a specific environment or environment and service route.

Project Overview opens on the environment that currently has the live route when that differs from the default environment. Use the environment tabs to switch scope. The `Project Deployments` action in that screen is scoped to the currently selected environment and opens run history for that environment.

That run history stays environment-scoped. Use `Details` to inspect one deployment run, or `Rollback` on a historical succeeded run when you want to restore that recorded project rollout.

If app access requires authentication, opening a browser app URL sends you through the control-plane login flow first and then returns you to the original app path.

On the active Projects page, Compartment also refreshes the visible project lifecycle and status fields automatically. Use the browser view when you want a live operator overview while deploy, start, stop, archive, or unarchive actions are still settling.

Project-scoped commands usually resolve the default project from the current repository descriptor. `project archive` and `project delete` are the destructive exceptions and require explicit `--yes` confirmation. `project delete` also requires an explicit `--project <slug>` target.

Compartment also ships project runtime commands:

```bash
compartment project start
compartment project stop
```

Next steps:

- Read [Deployment Lifecycle](/deploy-apps/deployment-lifecycle/).
- Read [Custom Domains for Apps](/deploy-apps/custom-domains-for-apps/).
- Browse the [generated project command reference](/reference/generated/cli/project/).
