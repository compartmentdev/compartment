---
title: Audit Logs
description: List and export organization audit events from Compartment.
---

Audit logs are organization-scoped records for access, settings, SSO, and Git source changes. Use them from the CLI when you need to inspect who changed organization policy or export records into another system. In the browser console, users with audit access can open **Audit logs** to inspect the same events with filters and pagination.

Audit access requires `organization.audit.read`. The built-in `admin` role includes it by default. Custom roles do not receive it automatically.

In the browser, audit logs stay on the selected organization path, such as `/orgs/acme-dev/audit`. If the current session can see more than one organization, choose the organization before the console loads audit events.

## List Events

Use the current organization context:

```bash
compartment audit list
compartment audit list --from 2026-05-01T00:00:00Z --to 2026-05-12T23:59:59Z
compartment audit list --event organization.user.invited --actor admin@example.com
compartment audit list --target-type role --output json
```

The audit surface records these organization events:

- organization settings and auth settings updated;
- SSO OIDC providers created, updated, or deleted;
- users invited, removed, blocked, unblocked, or issued single-organization install-operator password-reset links through `organization.user.password_reset_issued`;
- roles created, updated, or deleted;
- groups created, updated, deleted, or changed by membership;
- assignments created or deleted;
- Git sources connected, disconnected, settings changed, descriptors included or excluded, sync requested/succeeded/failed, push received, auto-deploy queued or skipped, and bindings created during connect or sync auto-adoption;
- audit exports created.

The console Audit logs page shows the event time, event type, actor, target, project id, status, and allowlisted metadata. Filter by time range, event type, actor, target type, and project id. The console uses the same retained audit-event API as `compartment audit list`.

Password-reset audit rows record issuance metadata, not the secret reset URL or token.

## Export Events

Export NDJSON for log pipelines or CSV for inspection:

```bash
compartment audit export --format ndjson --output -
compartment audit export --format csv --output audit-events.csv --from 2026-05-01T00:00:00Z
```

`--output -` writes to stdout, which is the simplest way to pipe events into another collector. Compartment does not import audit events back into its audit log.

Exports are generated synchronously for the request and are not stored as separate audit export artifacts.

Each export is capped at 10,000 events. If the selected filters match more events, the command fails with `audit_export_too_large`; narrow the time range or add filters such as `--event`, `--actor`, or `--target-type`.

## Local File Sink

Self-hosted installs can mirror audit events to local NDJSON files. The database remains the source of truth; the file sink is an operator-controlled export stream for local collectors.

The sink is disabled by default:

```bash
COMPARTMENT_AUDIT_FILE_SINK_ENABLED=false
COMPARTMENT_AUDIT_FILE_SINK_DIR=/var/lib/compartment/audit-logs
COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL=1d
COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE=64M
COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES=30
```

When enabled, Compartment writes sanitized audit events to `audit.ndjson`, rotates by time or size, compresses rotated files with gzip, and keeps the configured number of rotated files.

Packaged Docker installs bind-mount `COMPARTMENT_AUDIT_FILE_SINK_DIR` for the API container. Docker can create that host directory while the sink is still disabled; it stays empty until `COMPARTMENT_AUDIT_FILE_SINK_ENABLED=true`. When the sink starts, Compartment makes the directory owner-only and creates audit files with owner-only permissions.

## Retention Policy

The install default audit-retention window is `COMPARTMENT_AUDIT_RETENTION_DAYS=90`. An organization can inherit that default, set its own number of days, or keep audit events indefinitely:

```bash
compartment org settings get
compartment org settings set --audit-retention inherit
compartment org settings set --audit-retention indefinite
compartment org settings set --audit-retention 365
```

The API runs `audit.retention.cleanup` as a background job and removes expired database rows in bounded batches. New installs use `COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON="0 3 * * *"`; batch pressure is controlled by `COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE` and `COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES`. `indefinite` organizations are skipped.

## Secret Handling

Audit metadata is allowlisted per event. Compartment does not store raw environment values, variable plaintext or ciphertext, tokens, token hashes, passwords, private keys, webhook secrets, OAuth or OIDC client secrets, full headers, raw webhook payloads, `.env` files, compose files, or archives in audit metadata.

Allowed sensitive-adjacent facts are limited to values such as variable key names, sensitivity flags, fingerprints, repository names, branch names, commit ids, descriptor paths, and sanitized diffs without secret values.

Next steps:

- Read [Roles and Permissions](/manage-access/roles-and-permissions/).
- Browse the [audit command reference](/reference/generated/cli/audit/).
