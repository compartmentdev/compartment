---
title: Grant Access to Users and Groups
description: Invite users, create roles and groups, and attach scoped assignments with the Compartment CLI.
---

Use the smallest scope that solves the job:

- `organization`: use for organization-wide operators or admins;
- `project`: use for one project such as `billing`;
- `environment`: use for one environment such as `billing/production`.

## Invite the User

Invite the user into the current organization first:

```bash
compartment user invite alex@example.com
```

An invited user becomes a member of the organization. That does not grant project or environment access by itself.

The user also needs a real sign-in path before they can use the CLI or protected app routes:

- a local password through first-time activation;
- an SSO identity for the same organization.

In the browser control plane, invite the user from the Users drawer. If the invited email is new to the install and the organization still allows local passwords, copy the activation link from the invited user's detail drawer. Existing users keep their existing sign-in method; inviting them into another organization does not issue a new activation link. If the organization is SSO-only, the user signs in through SSO instead.

## Inspect Existing Roles

List the current roles and inspect the one you want to reuse:

```bash
compartment role list --output json
compartment role show rol_123 --output json
```

Use a built-in role when it already matches the job. Create a custom role when you need a smaller permission set.

In the browser control plane, open `Manage roles` from a user or group detail drawer when you want to adjust reusable roles without leaving the current organization context.

## Create or Update a Custom Role

This example creates a role that can inspect the `billing` project, read deployment logs, and open hosted app routes:

```bash
compartment role create "Billing Operator" \
  --permission project.read environment.read deployment.read deployment.logs.read variable.metadata.read app.route.access \
  --output json
```

If you already have a role, inspect it first and then send the permission keys you want to keep:

Built-in system roles are read-only. Use `role update` only for a custom role.

```bash
compartment role show rol_123 --output json
compartment role update rol_123 \
  --permission project.read environment.read deployment.read deployment.logs.read variable.metadata.read app.route.access \
  --output json
```

## Create a Reusable Group

Use a group when the same access should apply to more than one user:

```bash
compartment group create "Billing Operators" --output json
compartment group member add grp_123 alex@example.com --output json
compartment group member list grp_123 --output json
```

In the browser control plane, group descriptions are optional. Use them when the group name alone does not explain the access policy or team purpose.

## Create Assignments

Create a direct assignment when the access is unique to one user:

```bash
compartment assignment create \
  --role rol_123 \
  --scope organization \
  --user alex@example.com \
  --output json
```

Create a group-driven assignment when the access should follow the group:

```bash
compartment assignment create \
  --role rol_123 \
  --scope project \
  --project billing \
  --group grp_123 \
  --output json
```

Use environment scope when only one environment should get the grant:

```bash
compartment assignment create \
  --role rol_123 \
  --scope environment \
  --project billing \
  --environment production \
  --user alex@example.com \
  --output json
```

## Verify or Revoke Access

List assignments after every change so you can confirm the current scope, subject, and role:

```bash
compartment assignment list --output json
```

In the browser control plane, the Users page shows friendly access summaries in the table. Open the `Effective permissions` drawer section to review inherited and direct permission families. The Groups page uses the same collapsible `Effective permissions` section for shared access, while the Role drawer opens that section by default so you can review permission keys immediately.

To remove a grant, delete the assignment directly:

```bash
compartment assignment delete asg_123 --yes --output json
```

Access-management changes are rejected when they would remove the current session's admin path or leave the organization without an unblocked admin who can sign in. Replace any old `organization.user.manage` grants manually with the split user permissions.

Next steps:

- Read [Access, Organizations, Users, and Roles](/manage-access/access-organizations-users-and-roles/).
- Read [Roles and Permissions](/manage-access/roles-and-permissions/).
- Read [Troubleshoot Access](/manage-access/troubleshoot-access/).
- Browse the [generated role command reference](/reference/generated/cli/role/).
- Browse the [generated group command reference](/reference/generated/cli/group/).
- Browse the [generated assignment command reference](/reference/generated/cli/assignment/).
