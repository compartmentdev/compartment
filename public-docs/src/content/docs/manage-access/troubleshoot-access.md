---
title: Troubleshoot Access
description: Diagnose sign-in, membership, scope, and hosted app access issues in Compartment.
---

Start with the current state:

```bash
compartment user list
compartment assignment list --output json
compartment role show rol_123 --output json
compartment group member list grp_123 --output json
```

## An Invited User Cannot Sign In Yet

`compartment user invite` adds organization membership. It does not create a local password or an SSO identity.

If the user cannot sign in yet, check whether they still need:

- account activation for local-password login;
- an SSO identity that matches the organization configuration.

Password reset is a recovery path for an existing single-organization local-password account, not a way to activate an invited or SSO-only user.

## A User Shows `Membership only`

`Membership only` means the user is in the organization but does not currently have any role assignments there.

If you expected access, check whether the user is missing:

- a direct assignment;
- a group assignment.

Grant a built-in organization role only when you want organization-wide built-in access. Otherwise create the direct or group assignment the user still needs.

## A User Can Access One Scope but Not Another

Compartment resolves access from the nearest scope outward: environment, then project, then organization. It stops at the first scope that has any grants.

Example:

- Alex has an organization-scoped role with broad read access.
- Alex also has an environment-scoped role on `billing/production` with only `deployment.logs.read`.

At `billing/production`, Compartment uses the environment grants instead of falling back to the broader organization grants. If two roles apply at `billing/production`, their permission keys are unioned at that environment scope.

When access looks narrower than expected, check for project or environment assignments before you assume the organization role is missing.

## A User Can Sign In but Cannot Open a Hosted App

Protected hosted app routes need `app.route.access`.

The built-in roles include it. Custom roles do not unless you add it explicitly. If a user can sign in to the control plane but cannot open a protected app, inspect the assigned role and confirm that `app.route.access` is present at the scope that route resolves through.

## A Blocked User Cannot Sign In

Blocked users stay in the organization but cannot authenticate.

Restore access with:

```bash
compartment user unblock alex@example.com
```

## A Local-Password User Is Locked Out

A Kubernetes operator can issue a reset for an eligible existing single-organization local-password account without
a signed-in Compartment session. This includes recovery when the owner password is lost:

```bash
compartment system issue-password-reset \
  --email owner@example.com \
  --namespace compartment \
  --release-name compartment
```

The command prints a reset URL, the one-time token, and its expiry. Treat the output as a secret. Complete the reset
before the expiry; using the token consumes it. Issuing another reset replaces the previous token. Compartment records
`organization.user.password_reset_issued` in the audit log.

This command requires permission to get the API Deployment, list its Pods, and create the `pods/exec` subresource in
the release namespace. It uses the private operator channel inside that pod; Caddy does not expose the recovery
endpoint. Use `--kube-context` when the release is not in your current context.

## Automation Accounts Do Not Appear on the Browser Users Page

Compartment can create system-managed automation accounts after you connect a Git source.

Those entries are not human sign-in accounts. The browser Users page hides them, but CLI and API organization user lists can still return them with `type=automation`. Compartment manages their access through the owning source lifecycle instead of normal invite, activation, or assignment flows.

Next steps:

- Read [Access, Organizations, Users, and Roles](/manage-access/access-organizations-users-and-roles/).
- Read [Grant Access to Users and Groups](/manage-access/grant-access-to-users-and-groups/).
- Read [Roles and Permissions](/manage-access/roles-and-permissions/).
