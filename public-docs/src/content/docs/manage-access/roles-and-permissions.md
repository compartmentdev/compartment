---
title: Roles and Permissions
description: Understand built-in roles, permission keys, and when to create custom roles in Compartment.
---

Start with `compartment role list --output json` when you want to inspect the roles that exist in the current organization.

In the browser control plane, role management stays on its own page. Open it from the `Manage roles` action inside user or group details when you are working from those access screens.

## Built-in System Roles

- `admin`: full organization management, project lifecycle, deploy, variable, domain, source, and hosted app access.
- `deployer`: deploy and operate projects without organization user, group, role, or auth management.
- `readonly`: inspect environments, deployments, variable metadata, domains, and hosted app routes without mutation access.
- `viewer`: open projects and hosted app routes with the smallest built-in access set.

All built-in roles include `app.route.access`, so they can open protected hosted app routes when the scope allows it.

## Permission Families

Access management:
`organization.project.create`, `organization.user.read`, `organization.user.invite`, `organization.user.block`, `organization.user.remove`, `organization.user.credentials.reset`, `organization.group.read`, `organization.group.manage`, `organization.role.read`, `organization.role.manage`, `organization.auth.manage`, `organization.settings.manage`, `organization.audit.read`

Project setup:
`project.read`, `project.settings.write`, `project.archive`, `project.delete`, `source.read`, `source.manage`

Deployments:
`environment.read`, `project.lifecycle.write`, `deployment.read`, `deployment.create`, `deployment.promote`, `deployment.rollback`, `deployment.logs.read`, `deployment.inspect`

Runtime and configuration:
`variable.metadata.read`, `variable.value.read`, `variable.write`, `variable.local_run`

Domains and routing:
`domain.read`, `domain.write`, `app.route.access`

## Create a Custom Role

Create a custom role when a built-in role is too broad or when you want a reusable permission bundle for a group:

```bash
compartment role create "Billing Read Only" \
  --permission project.read environment.read deployment.read deployment.logs.read variable.metadata.read app.route.access \
  --output json
```

Inspect the role before you change it so the permission set stays explicit:

Built-in system roles are read-only. Use `role update` only for a custom role.

```bash
compartment role show rol_123 --output json
compartment role update rol_123 \
  --permission project.read environment.read deployment.read deployment.logs.read variable.metadata.read app.route.access \
  --output json
```

The browser role editor groups permission keys into the same families and lets you select an entire family at once. Add a description when the role name does not fully explain its purpose.

## Design Roles Carefully

- Start from the smallest scope that matches the job. Scope controls where a role applies. Permission keys control what it can do there.
- Keep `app.route.access` explicit for any custom role that must open protected hosted app routes.
- Grant `organization.audit.read` only to operators who should inspect or export organization audit events.
- Separate organization management from deploy and inspection duties unless the same operators genuinely need both.
- `organization.role.manage` can only grant permission keys the acting principal already has at the target scope.
- Prefer groups when more than one person should receive the same assignments.

Next steps:

- Read [Grant Access to Users and Groups](/manage-access/grant-access-to-users-and-groups/).
- Read [Audit Logs](/manage-access/audit-logs/).
- Read [Troubleshoot Access](/manage-access/troubleshoot-access/).
- Browse the [generated role command reference](/reference/generated/cli/role/).
