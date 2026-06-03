---
title: Resources
description: Declare and operate internal Docker-backed resources such as databases and caches.
---

Resources are internal Docker-backed runtime objects declared in `compartment.yml`.

Use them when an app needs a stateful dependency such as PostgreSQL, MySQL, Redis, Valkey, or another containerized
service that should run next to the deployed app.

Resources are not app services. They do not create public app routes or high availability. When a resource declares
outputs, Compartment derives those values at read or runtime resolution time.

## Declare a resource

Add a top-level `resources` map to `compartment.yml`:

```yaml
name: internal-tools

services:
  api:
    path: apps/api

resources:
  db:
    preset: postgres
```

`preset: postgres` expands before deploy into the same Docker-backed resource config that the rest of the runtime uses.
It is a small shortcut: only `env` can be supplied with the preset to override non-secret PostgreSQL config such as
`POSTGRES_DB` or `POSTGRES_USER`. Declare the expanded resource form instead if you need to change the image, ports,
readiness, outputs, volumes, or operations.

On first deploy, Compartment automatically creates a sensitive `POSTGRES_PASSWORD` variable scoped to that resource if
one is not already set. Redeploys reuse the stored value. It uses that password for the preset container and for the
preset `connection-url` output.

The preset is equivalent to this expanded resource config:

```yaml
resources:
  db:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: app
      POSTGRES_USER: app
    generatedVariables:
      POSTGRES_PASSWORD:
        generator: token
    ports:
      - 5432
    readiness:
      type: tcp
      port: 5432
      timeoutMs: 60000
    volumes:
      data: /var/lib/postgresql/data
    outputs:
      connection-url:
        sensitive: true
        value: postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}
      host:
        sensitive: false
        value: ${resource.host}
      port:
        sensitive: false
        value: '5432'
      database:
        sensitive: false
        value: ${env.POSTGRES_DB}
    operations:
      backup:
        command: PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/postgres.sql"
        schedule:
          interval: daily
          retention:
            maxAgeDays: 7
      restore:
        command: PGPASSWORD="$POSTGRES_PASSWORD" psql --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/postgres.sql"
```

The resource name is `db`. The preset volume handle is `data`, mounted at `/var/lib/postgresql/data`.

Resource fields:

- `preset`: optional built-in preset. The first supported value is `postgres`.
- `image`: required Docker image unless `preset` provides one.
- `command`: optional command array.
- `env`: optional literal environment map for non-secret static config.
- `generatedVariables`: optional server-generated sensitive resource variables.
- `ports`: optional internal TCP ports.
- `outputs`: optional derived values such as hostnames or connection strings.
- `volumes`: optional named volume handles mapped to absolute container mount paths.
- `readiness`: optional TCP readiness check.
- `restart`: optional restart policy.
- `operations`: optional `backup` and `restore` commands, backup schedule, and backup retention.

Use the generated schema reference for the exact current contract.

## Define outputs

Resource outputs are named derived values. They are useful when a service needs a value built from the reconciled
resource hostname, project or environment name, and resource-scoped runtime variables. The PostgreSQL preset already
provides the outputs shown in the equivalent config above. Generic resources can declare outputs explicitly.

An output can use these placeholders:

- `${resource.name}`
- `${resource.host}`
- `${project.name}`
- `${environment.name}`
- `${env.KEY}`

Every output must declare whether it is sensitive:

```yaml
resources:
  analytics-db:
    image: postgres:16
    env:
      POSTGRES_DB: app
      POSTGRES_USER: app
    outputs:
      connection-url:
        sensitive: true
        value: postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}
```

Inspect outputs after the resource exists:

```bash
compartment resource output list --resource db
compartment resource output show connection-url --resource db
compartment resource output show connection-url --resource db --reveal
```

Sensitive outputs are hidden by default. `--reveal` prints plaintext and records a sensitive access audit event. The
resolved plaintext is not stored as a variable. Revealing sensitive output plaintext requires variable value disclosure
access for the environment.

## Add secrets

Resource secrets and per-resource config live in runtime variables scoped to the resource target. Resources do not
inherit environment-scoped or service-scoped variables.

For `preset: postgres`, Compartment creates `POSTGRES_PASSWORD` automatically on first deploy when it is missing. Set it
manually only if you intentionally want a custom initial password before the first deploy:

```bash
printf '%s' '<custom-password>' | compartment variable set POSTGRES_PASSWORD --resource db --sensitive --stdin
```

For generic resources, declare generated resource variables explicitly:

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

`generator: token` creates a random sensitive resource-scoped runtime variable on deploy when `POSTGRES_PASSWORD` is
missing. Redeploys preserve the existing value. If you remove the stored variable while the descriptor still declares
it, the next deploy creates a new value. Literal `resources.<name>.env` entries cannot use the same key as
`generatedVariables`. `bytes` defaults to `24` and `encoding` defaults to `hex`; supported encodings are `hex` and
`base64url`.

Use descriptor connections when a service should receive a resource output as a runtime variable:

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

`connections.db.env.DATABASE_URL: connection-url` stores a `db.connection-url` reference, not the resolved plaintext.
Compartment resolves it during runtime variable injection after the resource is reconciled. With `preset: postgres`, the
first deploy can create the missing `POSTGRES_PASSWORD`, reconcile the database, and inject `DATABASE_URL` without a
separate variable command.

The CLI binding command remains available as an escape hatch for values you do not want in `compartment.yml`:

```bash
compartment variable set DATABASE_URL --service api --from-resource db.connection-url
```

CLI output bindings can be created before the first deploy as long as local `compartment.yml` declares the `api`
service, the `db` resource, and the `connection-url` output.
Remove it with the normal service variable command:

```bash
compartment variable remove DATABASE_URL --service api
```

Descriptor connections and CLI output bindings are runtime variables. They cannot be selected in `build.env`. A direct
service variable and a resource-output binding for the same service/key conflict instead of silently choosing a winner.
Adding a descriptor connection also fails when that service/key already has a manual CLI resource-output binding to a
different resource output.
Service-scoped generated variables are not part of this descriptor surface.

## Deploy

Run deploy from the repository root:

```bash
compartment deploy
```

During deploy, Compartment reconciles declared resources before app services. It creates or updates the resource
container, attaches declared volumes, and waits for resource readiness before building and starting the selected
services.

## Connect from an app

Apps connect to a resource by its internal hostname:

```text
<resource>.<environment>.<project>.resource.internal
```

For the example above in `production`:

```text
db.production.internal-tools.resource.internal
```

An API service can use that host with the declared internal port:

```text
postgres://app:<password>@db.production.internal-tools.resource.internal:5432/app
```

Keep this connection string in runtime variables or app config. Do not expose resource ports through public domains or
route rules.

## Operate resources

Use `compartment resource` commands after deploy:

```bash
compartment resource list
compartment resource inspect --resource db
compartment resource logs --resource db --tail 50
compartment resource stop --resource db
compartment resource start --resource db
```

Use `--project`, `--env`, `--remote`, or `--output json` when you need an explicit target or automation-friendly output.

Built-in `deployer` and `admin` roles can inspect resource inventory and logs. Built-in `readonly` and `viewer` roles cannot.

If you use custom roles, `resource list`, `inspect`, `logs`, `output list`, `output show`, and
`backup create|list|show|restore` require `deployment.create` on the target environment. This includes
restore-to-new-resource with `--as`. Deploy-time creation of missing `generatedVariables` also uses
`deployment.create`. `resource logs` also requires `deployment.logs.read`. Revealing a sensitive resource output with
`output show --reveal` also requires `variable.value.read`.

## Back up and restore

The PostgreSQL preset already includes backup and restore operations, plus a scheduled daily backup with 7-day retention.
For generic or full resources, add `operations.backup.command` before running `resource backup create`. In-place restore
also requires `operations.restore.command`, because it creates a pre-restore backup before applying the selected backup.
Restore-to-new-resource with `--as` uses the operation configuration saved with the selected backup. `resource backup
list` and `resource backup show` read existing backup records and do not require operation commands. Compartment runs
each command in a disposable container on the resource network and mounts the backup artifact workspace at `/backup`.
Backup commands can write to `/backup`; restore commands receive `/backup` read-only, so use another writable path such
as `/tmp` for restore scratch files. On self-hosted installs, backup and restore operation containers run as
`10001:10001`, so custom operation images must work without root privileges.

Set `COMPARTMENT_RESOURCE_BACKUP_DIR` to the same persistent absolute host directory for the API and node processes.
Relative backup directories are rejected. When upgrading from a relative backup directory, resolve the old directory
against the previous API working directory, move the artifact directories under the chosen absolute backup directory,
and reconcile stored backup artifact locations before relying on restore.

The operation image defaults to the resource image. Add `image` under the operation to use a different image. Operation
environment starts with the final resource runtime env, then overlays operation-specific literal `env`; Compartment does
not inject every project or environment variable automatically.

Compartment injects these variables into backup and restore commands:

- `COMPARTMENT_BACKUP_DIR=/backup`
- `COMPARTMENT_RESOURCE_HOST`
- `COMPARTMENT_RESOURCE_NAME`
- `COMPARTMENT_PROJECT_NAME`
- `COMPARTMENT_ENVIRONMENT_NAME`

Create and inspect backups:

```bash
compartment resource backup create --resource db
compartment resource backup list --resource db
compartment resource backup show --backup rbak_123
```

### Schedule backups

Add `operations.backup.schedule` to run backups without a user running `resource backup create`.

Use `interval: hourly`, `interval: daily`, or a standard five-field cron expression evaluated in UTC. Cron schedules
support standard minute, hour, day-of-month, month, and day-of-week fields, including steps, ranges, and lists:

```yaml
resources:
  archive-db:
    image: postgres:16
    operations:
      backup:
        command: pg_dump --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"
        schedule:
          cron: '0 2 * * 1'
          retention:
            keepLast: 7
            maxAgeDays: 30
```

Representative cron schedules include `*/15 * * * *` for every 15 minutes, `0 2 * * 1` for Mondays at 02:00 UTC, and
`0 2 1 * *` for the first day of each month at 02:00 UTC.

Scheduled backups use the same command, runtime environment, artifact workspace, and backup records as manual backups.
They appear in `compartment resource backup list` with purpose `scheduled`. The list output also shows the configured
schedule, the last scheduled run, and how many backup records have been cleaned by retention.

Retention applies to scheduled backups by default. Set `includeManual: true` only when manual backups should also be
eligible for cleanup:

```yaml
retention:
  includeManual: true
  keepLast: 14
```

When retention cleans a backup, Compartment deletes the artifact directory and keeps the backup record with status
`deleted`, `retentionDeletedAt`, and `retentionReason` so operators can see what was cleaned.

Restore is destructive and requires confirmation. Compartment creates a pre-restore backup before it runs the selected
restore command:

```bash
compartment resource backup restore --resource db --backup rbak_123 --yes
```

In-place restore applies only to the same resource that created the backup. Compartment checks the current resource
definition and operation configuration before running the restore command.

To restore without overwriting the source resource, restore the backup into a new resource name:

```bash
compartment resource backup restore --backup rbak_123 --as postgres-restore
```

The new resource uses the resource definition captured with the backup, gets its own internal hostname, and appears in
`resource list` and `resource inspect`. Delete it with the same `resource delete` flow as any other
resource. If the target name already exists, the command fails before creating or restoring the new resource.

Restore-to-new-resource creates a running resource outside `compartment.yml`. Before the next deploy, either add the new
resource to `compartment.yml` or delete it; deploy blocks on resources that exist but are not declared.

Restore-to-new-resource does not create a pre-restore backup of the source resource and does not require `--yes`. Backups
created before resource definition snapshots were recorded can still be restored in-place, but cannot be restored with
`--as`. Do not combine `--resource` with `--as`; the command fails because in-place restore and restore-to-new-resource
are separate restore targets.

If the new resource is created but its restore operation fails, Compartment keeps the new resource so you can inspect or
delete it with the regular resource commands. Delete the resource before retrying the restore with the same target name.

## Delete or rename safely

Removing a resource from `compartment.yml` does not delete the running resource. The next deploy fails with guidance to
delete it explicitly. This prevents an accidental YAML edit from destroying state.

To remove the resource container but keep its volumes:

```bash
compartment resource delete --resource db
```

To remove the resource and delete its data volumes:

```bash
compartment resource delete --resource db --delete-data
```

You can delete a stopped resource with the same commands. When no resource container is running, Compartment removes the
resource record and deletes its named data volumes only when you pass `--delete-data`.

Renaming a resource is treated as deleting the old resource name and adding a new one. Migrate data first if you need to
keep it.

Changing the mount path of an existing volume handle is blocked during deploy. Create a new volume handle and migrate
data, or delete the old resource when the data is no longer needed.

## Another example

Valkey without persistence:

```yaml
resources:
  cache:
    image: valkey/valkey:8
    ports:
      - 6379
    readiness:
      type: tcp
      port: 6379
```

Next steps:

- Read [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/).
- Read [Runtime Variables](/deploy-apps/runtime-variables/).
- Browse the [generated resource command reference](/reference/generated/cli/resource/).
- Browse the [generated descriptor schema reference](/reference/generated/schema/compartment-yaml/).
