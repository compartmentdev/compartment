---
title: Deployment Lifecycle
description: Follow rollout state, inspect live deployments, promote builds, and roll back safely.
---

Every `compartment deploy` creates deployment records for the selected services.

The normal rollout loop is:

```bash
compartment deploy
compartment status
compartment logs
compartment inspect
compartment deployment list
compartment deployment logs --follow
```

Compartment queues deployments per selected service, runs the service build path, stores immutable image references, and
activates runtime state only after the candidate starts successfully.

If a service declares `release.command`, it runs once before the candidate starts and routes switch. A non-zero exit or
10-minute timeout fails that deploy attempt and leaves the previous active deployment serving traffic.

For `kind: static`, the deploy still ends as an immutable image-backed rollout, but the service contract is narrower:

- `build.outputDirectory` is required;
- `build.strategy` is not allowed;
- authored `run` is not allowed;
- authored `release` is not allowed;
- authored `readiness` is not allowed;
- the final static-serving image is derived from the built output directory;
- `logs` reflect the static-serving container rather than an authored app server;
- promote and rollback still reuse the stored image result.

## Promote and roll back

Movement commands reuse an existing built image instead of rebuilding source. They do not rerun `release.command`;
schema changes that need a release command should go through a fresh deploy.

```bash
compartment promote --from <env> --to <env>
compartment rollback
compartment rollback --run <deployment-run-id>
compartment rollback --service web --to <deployment-id>
compartment deployment list
```

Use `promote` when you want to move an already built result between environments.

Use `rollback` in three modes:

- no explicit target: roll the selected environment back to the previous retained deployment for each currently active service;
- `--run <deployment-run-id>`: create a new environment-wide rollback run from a selected historical deployment run;
- `--service <name> --to <deployment-id>`: return one service to a known earlier deployment.

`--run` is the project-and-environment rollback path. It does not combine with `--service` or `--to`.

Run rollback also expects the selected historical run to cover every service that is currently active in that environment. If the environment topology has changed since that run, use a fresh deploy or a service-specific rollback instead of forcing a mixed rollback.

Manual `deploy`, `promote`, and `rollback` flows require an active human account with a usable login path such as a local password or SSO identity. Connected Git-source automation accounts are reserved for managed source-driven sync and deploy work, and invited human users without a usable login path cannot run those mutation flows yet.

## Rollback retention

Reusable deployment images stay available only while the current rollback-retention policy keeps them. When an older image falls out of that window, Compartment keeps the deployment record but marks the reusable image as cleaned.

That affects both the CLI and the browser control plane:

- rollback and promote only stay available while the reusable image is still retained;
- older deployment records stay visible in history even after their reusable image is no longer available for rollback or promote.

Use the current organization context when you want to inspect or change that policy:

```bash
compartment org settings get
compartment org settings set --rollback-retention inherit
compartment org settings set --rollback-retention indefinite
compartment org settings set --rollback-retention 5
```

## Deployment history and logs

Use the deployment subcommands when you need the event trail for earlier rollouts instead of only the currently active state:

```bash
compartment deployment list
compartment deployment logs
compartment deployment logs --run <id> --project <name> --service web --follow --verbose
```

Without `--run`, `compartment deployment logs` reads the latest deployment run in the selected project, environment, and service scope. Use `--run <id>` with the run id from `compartment deployment list` or the `Run:` value in detached deploy output when you want an earlier rollout instead.

The browser control plane also exposes deployment history and deployment run details for projects, which is useful when you want to inspect older rollouts interactively instead of staying in the CLI.

`compartment logs` reads the retained product log store. `--follow` polls that same store for new lines; it is a viewing convenience and does not replace durable capture. Logs remain available after a Kubernetes Pod is replaced or removed until the install retention window expires.

`compartment status` includes the latest raw CPU and RAM sample for each active Pod when metrics-server is available. The deployment details page shows the same samples. These values are point-in-time operational data, not monitoring or alerting; stale and unavailable samples are labelled explicitly.

In text output, `compartment deployment list` is grouped by deployment run. Each run block shows the aggregate run state first, then the service deployments that belong to that run.

Browser deployment history is grouped by deployment run for the selected environment. Each row shows the aggregate run status. If one service in the run fails, the row shows the run as failed and the details page shows which service failed, along with the run timeline and logs.

Historical succeeded run rows also expose `Rollback`. That action creates a new rollback run for the selected environment when the chosen historical run still covers the currently active service set and retained images are still available.

Open `Details` to inspect one deployment run: trigger, services in that run, timeline steps, and persisted logs. While a run is still queued or running, the browser deployment details page refreshes its log panel automatically so you can watch build and rollout output without reopening the page.

## Detached deploys

Use `--detach` on `compartment deploy` when you want the deployment run id immediately and will follow status later.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Deploy using Git](/deploy-apps/deploy-using-git/).
- Read [Projects and App URLs](/deploy-apps/projects-and-app-urls/).
- Browse the [generated CLI reference](/reference/generated/cli/deploy/).
