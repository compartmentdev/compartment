---
title: System Operations
description: Operate an existing Compartment install after the system is already in service.
---

Use these commands after the install already exists and you are operating the runtime itself:

```bash
sudo compartment system status
sudo compartment system restart
sudo compartment system update
sudo compartment system issue-password-reset --email admin@example.com
```

What they do:

- `system status`: check runtime health for the platform services, including the host node agent and internal BuildKit builder, see the active Console URL, get the local CLI login commands, and confirm the install-level rollback-retention default.
- `system restart`: restart the self-hosted runtime services and the host node agent after configuration changes.
- `system update`: apply a newer runtime version after upgrading the CLI binary, including the host node agent used for deployments and logs.
- `system issue-password-reset`: issue an audited recovery link for a single-organization local-password user. Organization managers cannot issue reset links from the console.

Existing installs created before this version may not have an `imageRegistry` value in `install-state.json`. For those installs, registry-based updates default to GitHub Container Registry unless you pass `--image-registry docker-hub`. Local-image installs keep their existing Docker Hub-style image names unless you choose another registry explicitly.

For registry image sources, `system update` verifies Compartment runtime image signatures with the bundled CLI verifier before pulling images and before replacing active runtime files. `system restart` verifies signatures before starting containers. A missing or invalid signature stops the affected registry runtime image from running.

If `system status` shows `node` as failed or missing, deployments, runtime logs, resource operations, and runtime
reconciliation will not run until the host node agent is healthy again. Use `sudo compartment system restart` after
fixing host runtime or Docker access issues.

Set `COMPARTMENT_ROLLBACK_RETENTION_LIMIT` in the install env to choose the install-wide default rollback window for
reusable deployment images. Use a positive integer for a bounded window or an empty value for indefinite retention. A
missing variable is invalid. `sudo compartment system status` shows the active default.

Set `COMPARTMENT_AUDIT_RETENTION_DAYS` in the install env to choose the default audit-retention policy for organizations that inherit the install default. New installs default to `90`.

Audit retention cleanup runs automatically from the API job scheduler. New installs use `COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON="0 3 * * *"`. Each run deletes expired rows in bounded batches controlled by `COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE` and `COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES`.

Set `COMPARTMENT_AUDIT_FILE_SINK_ENABLED=true` when you want the install to mirror sanitized audit events to local NDJSON files. New installs keep it disabled. Use `COMPARTMENT_AUDIT_FILE_SINK_DIR`, `COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL`, `COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE`, and `COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES` to choose the directory, rotation, and retained file count.

Packaged Docker installs bind-mount the configured file sink directory into the API container, so Docker can create the host directory before the sink is enabled. The directory stays empty while disabled, and Compartment locks it down to owner-only permissions when the sink starts.

Set `COMPARTMENT_TRUSTED_OUTBOUND_HOSTS` when an external service used by the install has a public HTTPS host that is not trusted by default. OIDC SSO browser authorization endpoints use this allowlist when the provider is not a built-in Google or Microsoft host.

For install-level domain work, use:

```bash
sudo compartment system domain status
sudo compartment system domain verify
sudo compartment system domain activate
```

For app-facing custom domains, use:

```bash
compartment domain list
compartment domain show <host>
compartment domain verify <host>
```

Next steps:

- Read [Deployment Lifecycle](/deploy-apps/deployment-lifecycle/).
- Browse the [system command reference](/reference/generated/cli/system/).
