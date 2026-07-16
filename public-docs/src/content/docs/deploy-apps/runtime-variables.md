---
title: Runtime Variables
description: Manage the environment variables injected into running apps and reuse them locally when debugging.
---

Compartment variables are runtime variables for your deployed apps.

Use them for values such as:

- database connection strings;
- third-party API tokens;
- per-environment service URLs;
- feature flags or tenant-specific configuration;
- secrets that should not live in the repository.

Manage them from the CLI:

```bash
compartment variable set
compartment variable import
compartment variable group create
compartment variable group put
compartment variable group import
compartment variable group capture
compartment variable bind
compartment variable unbind
compartment variable list
compartment variable show
compartment variable remove
compartment variable run -- <command>
```

Use project, environment, service, and resource selectors when a variable should apply only to a narrower target.

Use variable groups when the same runtime configuration should be reused across multiple targets. A variable group is an
organization-scoped bundle of variables. It does not affect any app until you bind it to a project, environment, service,
or resource target.

Typical group flows:

```bash
compartment variable group create postgres-prod
compartment variable group put postgres-prod DATABASE_URL --sensitive
compartment variable bind postgres-prod
compartment variable bind postgres-prod --resource postgres
```

Binding is per target scope. If another group is already bound at the same scope and exposes one of the same keys,
`compartment variable bind` fails with `variable_collision` instead of layering the groups.

Capture is the bootstrap path when the variables already exist on one target and you want to turn them into a reusable
group:

```bash
compartment variable group capture runtime-prod
compartment variable group capture worker-runtime --service worker --effective
compartment variable group capture postgres-runtime --resource postgres --effective
```

Without `--service`, capture reads only the environment-scoped target. It does not fold service-specific rows or
service-specific bindings into the new group. With `--resource`, capture reads the resource target. Use `--effective`
when you want the current winner map instead of direct rows only.

Kubernetes resources declared in `compartment.yml` receive literal `env` values from the descriptor plus variables
set or bound directly to that resource target. You can create resource-scoped variables before the first deploy as long
as the resource is declared under `resources.<name>` in local `compartment.yml`. The same local descriptor check applies
when binding a group, importing variables, capturing variables, or running a local command for a resource target:

```bash
openssl rand -hex 24 | compartment variable set POSTGRES_PASSWORD --resource postgres --sensitive --stdin
```

The PostgreSQL preset creates `POSTGRES_PASSWORD` automatically on first deploy when it is missing and reuses the stored
value on later deploys; set it manually only when you want a custom initial password.

Generic resources can declare the same server-side generation intent explicitly:

```yaml
resources:
  postgres:
    image: postgres:16
    generatedVariables:
      POSTGRES_PASSWORD:
        generator: token
        bytes: 32
        encoding: hex
```

Generated values are stored as sensitive resource-scoped variables. Redeploys preserve the existing value. Removing the
stored variable while the descriptor still declares it creates a new value on the next deploy. Service-scoped generated
variables are not part of this descriptor surface.
For `generator: token`, `bytes` defaults to `24` and `encoding` defaults to `hex`; supported encodings are `hex` and
`base64url`.

Resource targets do not inherit project-wide, environment-wide, or service-scoped variables.

Services can also receive a variable from a resource output. Prefer descriptor connections when the relationship belongs
to the app descriptor:

```yaml
resources:
  postgres:
    preset: postgres

services:
  api:
    path: apps/api
    connections:
      postgres:
        env:
          DATABASE_URL: connection-url
```

`connections.postgres.env.DATABASE_URL: connection-url` stores a reference to `postgres.connection-url`, not the
resolved value. The value is resolved during normal runtime variable resolution after the resource is reconciled. With
`preset: postgres`, the first deploy can create the missing `POSTGRES_PASSWORD` and then inject `DATABASE_URL` from the
connection output.

Use the CLI command as an escape hatch when you need to bind a resource output outside the descriptor:

```bash
compartment variable set DATABASE_URL --service api --from-resource postgres.connection-url
```

Descriptor connections and CLI output bindings are service-scoped and use the same runtime precedence slot as a direct
service variable, so Compartment rejects a direct service value and a resource-output binding for the same service/key.
When you add a descriptor connection for a key that already has a manual `--from-resource` binding to a different output,
deploy fails until the manual binding is removed or changed to the same resource output.
For the CLI command, `--from-resource` is the value source; do not combine it with a literal value, `--stdin`, or
`--sensitive`. The CLI validates the local descriptor before sending the request, so the service, resource, and output
must already be declared in `compartment.yml`; the service does not need to have been deployed yet.

Service `release.command` runs with the same effective runtime variables as the service container, so migration commands
can use resource-output bindings such as `DATABASE_URL`.

Remove the binding with the normal service-scoped remove command:

```bash
compartment variable remove DATABASE_URL --service api
```

Descriptor connections and CLI resource-output bindings resolve at runtime only. They cannot be selected in `build.env`.

After removing a resource from `compartment.yml`, you can still clean up its scoped variables and group bindings with
`compartment variable remove --resource <name>` and `compartment variable unbind --resource <name>`.

Typical patterns:

- project-wide values shared by every service;
- environment-specific values such as staging or production endpoints;
- service-specific values when one service needs credentials that another one should not receive.
- resource-specific values when one database or cache needs credentials that apps should not all receive.
- reusable group bindings for shared credentials such as database URLs or telemetry tokens.

`variable run` resolves the effective variable set for the selected variable scope and starts a local child command with those values. This is useful when you want to reproduce a deploy issue locally with the same runtime configuration.

For production environments, the CLI asks for confirmation unless you explicitly allow the run.

Use `--stdin` for sensitive values when you do not want them exposed in shell history.

Automation note: variable list, read, create, and import flows are contract-bound. Automation should rely on the documented variable fields and validation errors rather than on undeclared response properties.

Next steps:

- Read [Deployment Lifecycle](/deploy-apps/deployment-lifecycle/).
- Read [Resources](/deploy-apps/resources/).
- Browse the [generated variable command reference](/reference/generated/cli/variable/).
