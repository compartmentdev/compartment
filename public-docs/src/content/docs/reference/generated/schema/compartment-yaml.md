---
title: 'compartment.yml'
description: 'Generated reference for the current compartment.yml contract.'
---

This page is generated from the current descriptor contract factory in the repository.

Related guides:

- [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/)
- [Route Rules: compartment.routes.yml](/deploy-apps/route-rules/)

## File

- Name: `compartment.yml`
- Location: current directory

## Minimal Example

```yaml
name: <project-slug>

services:
  web: .
```

## Expanded Example

```yaml
name: internal-tools

services:
  site:
    accessMode: public
    kind: static
    path: apps/site
    build:
      command: pnpm build
      outputDirectory: dist
      env:
        - PUBLIC_API_BASE_URL

  web:
    accessMode: public
    path: apps/web
    build:
      # If include widens a source build, Railpack detects and installs from the widened root.
      # Include the package manager, lockfile, and workspace files that root build expects.
      strategy: railpack
      command: pnpm --filter @internal-tools/web build
      include:
        - package.json
        - pnpm-lock.yaml
        - pnpm-workspace.yaml
        - packages/shared-ui
      env:
        - VITE_PUBLIC_API_URL
      packages:
        build:
          - build-essential
        runtime:
          - libnss3
    run:
      command: pnpm --filter @internal-tools/web start
    readiness:
      type: http
      path: /ready
      timeoutMs: 10000

  api:
    path: apps/api
    kind: api
    connections:
      db:
        env:
          DATABASE_URL: connection-url

  worker:
    path: apps/worker
    kind: worker

resources:
  db:
    preset: postgres
    env:
      POSTGRES_DB: app
```

## Rules

- Project name must match `^[a-z][a-z0-9-]{0,62}$`.
- Project names reserved by the browser console: `create`.
- Services must contain at least one entry: `true`.
- Service names must match `^[a-z0-9][a-z0-9_-]{0,62}$`.
- Service values may be: string_path, service_config.
- Service config fields: accessMode, build, connections, path, kind, run, release, readiness.
- Required service config fields: path.
- Service connections use `connections.<resource>.env.<KEY>: <resource-output-name>`.
- Service connection env keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Service connection env keys must not start with COMPARTMENT\_.
- Service connection output names must match `^[a-z0-9][a-z0-9_.-]{0,62}$`.
- Service connection rule: connections and each connection env map must not be empty.
- Service connection rule: connection resource names must reference declared resources.
- Service connection rule: connection output names must reference declared or preset resource outputs.
- Service connection rule: connection env keys must be unique across all connections for one service.
- Build fields: command, env, include, outputDirectory, packages, strategy.
- Supported build strategies: auto, dockerfile, railpack.
- Supported kinds: web, api, static, worker, job, cron.
- Object form required for kinds: static.
- build.outputDirectory required for kinds: static.
- build.outputDirectory is only supported for kinds: static.
- build.outputDirectory must be a relative path inside the service directory and must not resolve to the service root.
- service-local Dockerfiles are ignored for kinds: static.
- build.strategy is not allowed for kinds: static.
- Run is not allowed for kinds: static.
- Release is not allowed for kinds: static.
- Readiness is not allowed for kinds: static.
- Run fields: command, restart.
- Release fields: command.
- Readiness fields: type, path, timeoutMs.
- Readiness types: http.
- Resources are optional.
- Resource names must match `^[a-z0-9][a-z0-9_-]{0,62}$` and must not collide with service names.
- Resource values may be: resource_config.
- Resource config fields: command, env, generatedVariables, image, operations, outputs, ports, preset, readiness, restart, volumes.
- Resource config must include one of these field sets: [image] or [preset].
- Resource presets: postgres.
- Resource preset override fields: postgres accepts only env.
- Resource generated variable fields: generator, bytes, encoding.
- Resource generated variable names must start with a letter or underscore, contain only letters, digits, and underscores, and must not start with `COMPARTMENT_`.
- Resource generated variable generators: token.
- Resource generated variable encodings: hex, base64url.
- Resource output names must match `^[a-z0-9][a-z0-9_.-]{0,62}$`.
- Resource output object fields: sensitive, value.
- Resource operation fields: command, env, image, schedule.
- Resource operation schedule fields: cron, interval, retention.
- Resource operation schedule intervals: daily, hourly.
- Resource operation cron schedules use standard five-field cron syntax in UTC, for example `*/15 * * * *`, `0 2 * * 1`, or `0 2 1 * *`.
- Resource operation retention fields: includeManual, keepLast, maxAgeDays.
- Resource readiness fields: type, port, timeoutMs.
- Resource readiness types: tcp.

## Defaults

- Service kind: `web`
- Build strategy: `auto`
- Build env defaults to an empty list.
- Build include defaults to an empty list.
- Build outputDirectory defaults to unset.
- Build packages defaults to build=an empty list and runtime=an empty list.
- Release defaults to disabled.
- Readiness defaults to disabled.
- Resource readiness defaults to disabled.

## Owns

- the repo-to-project slug link
- deployable service names
- hosted app access hints
- service-relative paths
- service build hints
- static build-output hints
- extra source-package include paths
- service kind hints
- service runtime-start hints
- service release commands
- service runtime variable references to resource outputs
- readiness hints
- resource generated-variable intent
- resource images, env, ports, volumes, readiness, outputs, and backup/restore operation intent

## Does Not Own

- service runtime variable plaintext, secrets, and environment-specific runtime values
- hosted domains
- deployment history
- browser-facing proxy rules
- resource secret/plaintext values, public ingress, backup records, backup artifacts, or restore state

## Related Files

- `compartment.routes.yml`: Browser-facing rewrites and proxy rules.
