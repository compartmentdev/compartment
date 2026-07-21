---
title: 'Project Descriptor: compartment.yml'
description: The main repository file that tells Compartment what to build, run, and expose.
---

`compartment.yml` is the first file to prepare when you want to deploy a repository with Compartment.

It is the project descriptor. Compartment uses it to understand:

- the canonical project slug;
- deployable service names;
- internal resource names;
- service paths;
- service build hints;
- static build-output hints;
- service runtime-start hints;
- service runtime variables that come from resource outputs;
- readiness hints;
- hosted app access hints.

Start with:

```bash
compartment init
```

That writes a minimal descriptor for the current repository.

Minimal example:

```yaml
name: internal-tools

services:
  web: .
```

The project name `create` is reserved for the Console create-project route, so choose another slug if your repository
or directory would otherwise derive that name.

Static sites use object form because `kind: static` requires `build.outputDirectory` and does not support `build.strategy`.
That directory must stay relative to the service directory and must not resolve back to the service root:

```yaml
name: marketing-site

services:
  site:
    kind: static
    accessMode: public
    path: apps/site
    build:
      command: pnpm build
      outputDirectory: dist
```

The repository also includes a complete static example under `examples/static-vite-react`.

For `kind: static`, keep the contract narrow:

- use `build.command` when the site needs a build step;
- use `build.include` when the build needs workspace files outside the service directory;
- use `build.packages.build` and `build.packages.runtime` only when the build or final static image needs extra system packages;
- a service-local `Dockerfile` is ignored;
- do not set `build.strategy`, `run`, `release`, or `readiness`.

Monorepos can use `build.include` to widen a source build to the workspace root. For Railpack builds, the widened
context root becomes the package-manager detection and install root. Include the root `package.json`, lockfile,
workspace file, and any shared packages needed by the build, then run a root-aware command:

```yaml
name: api-platform

services:
  api:
    kind: api
    path: packages/api
    build:
      strategy: railpack
      command: pnpm --filter @acme/api build
      include:
        - package.json
        - pnpm-lock.yaml
        - pnpm-workspace.yaml
        - packages/shared
```

Use `release.command` for one-off service work, such as migrations, that must pass before traffic moves to a freshly
deployed image. It runs with the service runtime variables; failure or timeout fails that deploy attempt.

```yaml
name: crm

services:
  api:
    path: apps/api
    release:
      command: pnpm db:migrate
```

Expanded example:

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

  web:
    accessMode: authenticated
    path: apps/web
    build:
      strategy: railpack
      command: pnpm build
    run:
      command: pnpm start
    readiness:
      type: http
      path: /ready
      timeoutMs: 10000

  api:
    path: apps/api
    connections:
      db:
        env:
          DATABASE_URL: connection-url

resources:
  db:
    preset: postgres
```

Use this file when you need to answer questions such as:

- what is the project called in Compartment;
- which directories become services;
- which internal Kubernetes resources should be reconciled before deploy;
- how should a service build;
- which directory a static build should publish;
- how should a service start;
- which resource outputs should be injected as service runtime variables;
- how should resource backup and restore commands run or be scheduled;
- how should Compartment decide the app is ready.

The top-level `resources` map declares Kubernetes resources for the project environment. Resources are internal-only
and are not deployable app services. They do not create public routes. Use `preset: postgres` for the built-in PostgreSQL
resource defaults, or declare a generic resource with `image`, `ports`, `volumes`, readiness, outputs, and operations.
Preset resources only accept `env` overrides; use the generic resource form for structural changes.
When a generic resource needs a generated secret, declare the generation intent under
`resources.<name>.generatedVariables`. When it needs to expose a derived value such as a connection string, declare it
under `resources.<name>.outputs`.

Resource outputs are derived when you read them or when Compartment injects a resource-output binding into runtime
variables. They are not stored as plaintext variables. Each output must declare `sensitive: true` or `sensitive: false`.
Sensitive outputs are hidden unless you explicitly reveal them.

Example generic resource with a generated resource-scoped password:

```yaml
resources:
  db:
    image: postgres:16
    env:
      POSTGRES_DB: app
      POSTGRES_USER: app
    generatedVariables:
      POSTGRES_PASSWORD:
        generator: token
        bytes: 32
        encoding: hex
    outputs:
      connection-url:
        sensitive: true
        value: postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}
```

Compartment creates the generated value on deploy only when it is missing. It stores the value as a sensitive
resource-scoped runtime variable, so normal reads show metadata but not plaintext.
For `generator: token`, `bytes` defaults to `24` and `encoding` defaults to `hex`; supported encodings are `hex` and
`base64url`.

Use `services.<service>.connections` when a service should receive a resource output as a runtime variable:

```yaml
resources:
  db:
    preset: postgres

services:
  api:
    path: apps/api
    connections:
      db:
        env:
          DATABASE_URL: connection-url
```

`connections.db.env.DATABASE_URL: connection-url` stores a reference to `db.connection-url`. Compartment resolves it at
runtime after the resource is reconciled. Resource-output connections are not available to `build.env`, and a direct
service variable with the same key is a deploy-time conflict. If a manual service-scoped resource-output binding already
uses the same key for a different resource output, deploy fails until you remove that binding or make the descriptor use
the same resource output.

Use `compartment resource list`, `inspect`, `logs`, `start`, `stop`, `delete`, and `backup` to inspect and
operate declared resources after deploy. Backup commands require `resources.<name>.operations.backup.command`. In-place
restore requires both `resources.<name>.operations.backup.command` and `resources.<name>.operations.restore.command`,
because it creates a pre-restore backup first. Restore-to-new-resource with `--as` uses the operation configuration saved
with the selected backup.

Add `resources.<name>.operations.backup.schedule` when a resource backup should run automatically. Schedules can use
`interval: hourly`, `interval: daily`, or a standard five-field cron expression evaluated in UTC, such as
`"*/15 * * * *"`, `"0 2 * * 1"`, or `"0 2 1 * *"`. Retention belongs under the schedule and can keep the newest
backups, keep backups for a number of days, or both. Manual backups are not eligible for scheduled retention unless the
schedule sets `includeManual: true`.

Use `compartment descriptor schema` for the current contract and examples.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Resources](/deploy-apps/resources/).
- Read [Route Rules: compartment.routes.yml](/deploy-apps/route-rules/).
- Browse the [generated resource command reference](/reference/generated/cli/resource/).
- Browse the [generated descriptor schema reference](/reference/generated/schema/compartment-yaml/).
