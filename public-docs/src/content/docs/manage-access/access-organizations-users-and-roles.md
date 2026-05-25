---
title: Access, Organizations, Users, and Roles
description: Use organizations, roles, groups, and assignments to control access across projects, environments, and hosted apps.
---

Compartment access has three separate parts:

- organization membership;
- a sign-in path through local password or SSO;
- authorization through roles and scoped assignments.

A user can have one without the others. `compartment user invite` adds membership. `compartment activate` or `compartment login` proves identity. Roles and assignments decide what the user can read, change, or open.

## Start with membership

An organization is the main collaboration boundary for:

- projects and their deployments;
- users invited into that space;
- role-based access to deploy, manage, or inspect the apps in it.

Use `compartment org use` before you run project, variable, or access-management commands in a different organization.

Common commands:

```bash
compartment org create
compartment org list
compartment org use
compartment user invite
compartment user list
compartment user block
compartment user unblock
compartment user remove
compartment role list
compartment role show
compartment role create
compartment group list
compartment group create
compartment group member add
compartment assignment list
compartment assignment create
compartment assignment delete
compartment audit list
compartment audit export
```

## Roles, Groups, and Assignments

Compartment ships four built-in system roles:

- `admin`
- `deployer`
- `readonly`
- `viewer`

You can also create custom roles from permission keys. A group lets you manage the same access for more than one user. An assignment attaches a role to either a user or a group at one of three scopes:

- `organization`: access across the whole organization;
- `project`: access to one project such as `billing`;
- `environment`: access to one environment such as `billing/production`.

Only organization admins can create additional organizations with `compartment org create` or the matching API route.

The browser control plane and the CLI use the same scoped RBAC model. The Projects, Users, Groups, and Roles pages all reflect the current organization context.

Organization-scoped control-plane URLs use `/orgs/<slug>/...` paths. Bare control-plane routes redirect to the scoped path when the session can see exactly one organization; otherwise, the page asks the user to choose an organization instead of inferring one. If the scoped path names an organization that is not visible to the current session, the page shows an organization-unavailable state instead of falling back to another organization. Older `?organization=<slug>` links redirect once to the canonical scoped path.

In the browser control plane:

- Users and Groups are searchable list pages that open create and detail flows in right-side drawers.
- After you invite a new email from the Users drawer, the invited user's detail drawer shows a local activation link only when that organization still allows local passwords. Existing users keep their existing sign-in method and do not receive a new activation link from the invite.
- User rows show friendly access summaries such as `Full access`, `Deploy`, `Read-only`, `Limited view`, `Membership only`, or `Custom`.
- User rows only surface direct-access exceptions outside org-wide grants, for example project- or environment-scoped direct assignments.
- Group rows show member count, assigned roles, scope coverage, and an optional description.
- Roles stay on a dedicated page and are opened from the `Manage roles` action inside user and group details instead of the main sidebar.

## Organization Login Settings

Organization login settings are also scoped the same way. `compartment login` always continues in the browser, so users sign in against the selected organization's current login policy there: local password on `/login` when passwords stay enabled for that organization, the configured SSO flow when they do not, or either path when both stay enabled.

After sign-in, the browser control plane and browser-assisted CLI login only list organizations that are visible to that session's sign-in method. The browser control plane keeps the organization selected during sign-in instead of falling back to another visible organization. A normal password-login session can list active memberships in organizations that still allow local-password login. Activation and password-reset sessions are scoped to the organization that issued the token. An OIDC SSO session is scoped to the organization that owns the provider used for that login.

Use the current organization context when you manage that policy from the CLI:

```bash
compartment auth settings get
compartment auth settings set --password enabled
compartment auth settings set --password disabled
```

Organization deployment and audit settings are scoped the same way. Use the current organization context when you want to inspect or override rollback retention or audit retention for that organization:

```bash
compartment org settings get
compartment org settings set --rollback-retention inherit
compartment org settings set --rollback-retention indefinite
compartment org settings set --rollback-retention 5
compartment org settings set --audit-retention inherit
compartment org settings set --audit-retention indefinite
compartment org settings set --audit-retention 365
```

`inherit` uses the install default. For rollback retention, `indefinite` disables image cleanup and a positive integer keeps the last `N` reusable deployment images per service. For audit retention, `indefinite` records an indefinite policy and a positive integer records an `N`-day policy.

## How Scope Resolution Works

When Compartment checks access, it walks from the nearest scope outward: environment, then project, then organization. It stops at the first scope that has any grants.

If more than one role applies at that same scope, their permission keys are unioned.

This matters when you narrow access at a lower scope. A user can have broad organization access and still get a smaller permission set at `billing/production` if that environment has its own direct or group assignments. At that environment, Compartment uses the environment grants instead of falling back to broader project or organization grants.

## Hosted App Access

Protected hosted app routes require `app.route.access`. Public routes with `accessMode: public` do not.
When `compartment.routes.yml` proxies from a public service to an authenticated target service, the proxied target request still requires login and `app.route.access` for the target route scope.

If you create a custom role for a protected hosted app, include `app.route.access` alongside the read or write permissions you want at the same scope.

In the browser control plane, `admin`, `deployer`, and `readonly` users can inspect deployment history. `viewer` users do not get deployment-history access or Users-page access. They can still open protected apps from project pages or a direct route URL when they have `app.route.access`.

## Special User States

User surfaces can show `membership-only` or `Membership only` when a member is in the organization but has no current role assignments in that organization. The browser user list uses the same idea for its friendly access summary.

Grant a built-in organization role, a custom direct assignment, or a group assignment depending on the access the user actually needs.

Read-only deployment access is redacted by design. Users without deploy-capable access can inspect current deployment state, but Compartment hides sensitive runtime topology such as upstream hosts, ports, container ids, and image refs.

Use `compartment user block` when an account should stay in the organization but must not be allowed to sign in. Use `compartment user unblock` to restore access later.

Destructive access-removal commands require explicit confirmation in the CLI. Use `--yes` with `compartment user remove`, `compartment role delete`, and `compartment group delete`.

User lists can also include system-managed automation accounts, for example when you connect a Git source. Those entries are not human sign-in accounts. Compartment marks them as system or automation entries and manages their access through the owning source lifecycle instead of normal user-management actions.

Automation note: organization user lists return the documented `type` field so you can distinguish human users from automation accounts. Do not depend on undeclared list columns or mutation payload properties.

Next steps:

- Read [Grant Access to Users and Groups](/manage-access/grant-access-to-users-and-groups/).
- Read [Roles and Permissions](/manage-access/roles-and-permissions/).
- Read [Audit Logs](/manage-access/audit-logs/).
- Read [Troubleshoot Access](/manage-access/troubleshoot-access/).
- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Read [Single Sign-On](/manage-access/single-sign-on/).
