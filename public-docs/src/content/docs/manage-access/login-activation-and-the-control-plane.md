---
title: Login, Activation, and the Control Plane
description: Use the CLI and the browser control plane to authenticate to an install and manage interactive access.
---

Compartment has both:

- a CLI surface for deploy and operator workflows;
- a browser control plane on `console.<baseDomain>` for interactive management.

Use the CLI when you want to deploy, inspect, or automate. Use the browser control plane when you want the interactive UI for the same install.

The control plane and hosted app routes share the same browser sign-in flow. When you open a protected app URL, Compartment redirects you to the control-plane login page and then sends you back to the original app path after sign-in.

On installs with exactly one organization, the browser `/login` flow skips the initial email-discovery step and goes straight to that organization's available login methods.

The main CLI auth entrypoints are:

```bash
compartment login
compartment activate
compartment logout
compartment whoami
compartment remote list
compartment remote use <name>
```

Current local-password flows include:

- invited-user activation;
- current-user session inspection and logout.

For non-interactive invited-user activation, provide the new password through
`COMPARTMENT_VIEWER_PASSWORD` and pass the email and invitation token as options:

```bash
: "${COMPARTMENT_VIEWER_PASSWORD:?Load it from your secret manager first}"
export COMPARTMENT_VIEWER_PASSWORD
compartment activate \
  --api-url https://console.example.com \
  --email viewer@example.com \
  --token "$INVITATION_TOKEN"
```

The password must contain at least eight characters. Supply it from your CI or secret-management system and avoid
persisting it in shell history or committed files.

Activation links are issued only for newly created local-password users and are bound to the inviting organization. If a user is invited to another organization before activating, the original activation link still signs the browser into only the original organization. The link stops working if that organization no longer allows local-password access for that user, even when another organization still does.

Human accounts can use runtime actions only after they have a real login path: a local password or an SSO identity. An invited human user without either can stay visible in the organization, but cannot run deploy or deployment-mutation flows yet.

System automation accounts do not sign in through `login` or `activate`. Compartment uses them only for internal managed actions such as connected Git-source automation.

Authentication state and role assignment are tracked separately. A user can have an active account and still appear as `Membership only` until an operator grants a direct assignment or group-based assignment in that organization.

Logging in proves who the user is. It does not grant broad project, environment, or hosted app access by itself. Those permissions still come from built-in roles or scoped assignments.

The organizations shown after login are also session-scoped. If a user belongs to multiple organizations, Compartment only exposes the organizations that match the sign-in method used for the current session. Browser sign-in lands back in the organization selected for that login, and stale organization links do not silently switch you into another organization. Sign in again through the other organization's allowed method when you need to switch into an organization that is not shown.

The browser control plane keeps `/` as the only unscoped entry. If your session can access more than one organization, `/` shows the organization chooser. If your session can access exactly one organization, `/` redirects straight into that organization's Projects page.

Organization-scoped control-plane pages use organization paths such as `/orgs/acme-dev/projects`, `/orgs/acme-dev/audit`, and `/orgs/acme-dev/onboarding`. If the organization in the path is not available to the current session, the page asks you to choose an accessible organization instead of loading data from another one.

The normal pattern on a new machine is:

1. install the CLI;
2. run `compartment login --api-url <control-plane-url>`;
3. use the same install in the browser at `console.<baseDomain>` when you need the UI.

Signing out from the browser control plane ends that browser session. A later visit to a protected app URL or control-plane page prompts you to sign in again.

## Browser-assisted CLI login

`compartment login` always continues in the browser.

The CLI prints a verification URL, waits for browser authentication to finish, and then completes the CLI session automatically.

If the selected organization allows local password login, you enter that password on the browser `/login` page. If the organization uses SSO, the same browser flow can continue through the configured SSO provider.

That same single-organization shortcut applies during browser-assisted CLI login: if the install has exactly one organization, the browser handoff opens that organization's available login methods immediately instead of asking for an email first.

If the browser is already signed in as a different user, Compartment keeps you on the login page until you sign out of that browser session or switch to the expected account.

`--email <email>` is optional. Use it only when you want the browser login form prefilled for that user. If you omit it, the browser login form stays blank.

`compartment login` no longer asks for passwords directly in the terminal.

## Remote profiles

Each successful CLI login stores or updates a named remote profile for that install.

Use `compartment login --api-url <control-plane-url>` on a new machine when no remote profile exists yet.

Use `compartment remote use <name>` only after you already have a stored remote profile. It switches the current remote selection, but it does not create a new login.

Use remotes when you sign into more than one Compartment install from the same machine:

```bash
compartment login --remote prod-eu --api-url https://console.example.com --email admin@example.com
compartment remote list
compartment remote use prod-eu
compartment whoami --remote prod-eu
```

The same command also works without `--email` when you do not want a prefilled browser login:

```bash
compartment login --remote prod-eu --api-url https://console.example.com
```

If a stored remote exists but the session has been cleared, log in again with the remote name:

```bash
compartment login --remote prod-eu
```

You only need `--api-url` again when you are creating the remote profile for the first time or changing it to a different control-plane URL.

If you run `compartment login --api-url <control-plane-url>` while the current remote already points to another control-plane URL, the CLI asks for a new remote name. It keeps the existing remote profile. To reuse that name for the new install, remove the old profile first:

```bash
compartment remote remove prod-eu
compartment login --remote prod-eu --api-url https://console.example.com
```

Most authenticated CLI commands also accept `--remote <name>` when you want to target a non-default install without switching the current remote first.

If that remote name is not stored locally yet, create it first with `compartment login --remote <name> --api-url <control-plane-url>`.

## Repo bindings

Remote profiles are machine-local credentials. Repository targeting is separate.

Compartment stores the current repo binding in `.compartment/state.json`.

When you run `compartment login` or `compartment activate` inside a repository that has a `compartment.yml` but no saved binding yet, the CLI offers to save a binding for that repo. In a Git repository, you can save it at:

- the Git root, which becomes the default binding for projects in that repo;
- the current project scope, which overrides the Git-root binding for that project only.

Compartment treats a saved repo binding as local machine state. Do not commit `.compartment/state.json` as shared
repository configuration. When the CLI writes that file inside a Git repository, it adds the state file to the nearest
`.gitignore`.

If a checked-in or copied `.compartment/state.json` points to a remote that is not configured on your machine, `compartment login` and `compartment activate` can repair that local binding to the remote you just authenticated.

Use `compartment remote use <name>` from a project directory when you want a project-scoped override. Run it from the Git root when you want to change the repo-wide default binding.

If `compartment deploy` runs interactively in a repo with no saved binding and more than one configured remote, it asks
which remote to use and saves that choice in `.compartment/state.json`. Non-interactive and JSON-output deploys require
`--remote <name>` or an existing repo binding.

Compartment also ships organization login settings commands:

```bash
compartment auth settings get
compartment auth settings set --password enabled
```

Use those commands to control whether local password login stays enabled for the current organization.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Access, Organizations, Users, and Roles](/manage-access/access-organizations-users-and-roles/).
- Read [Grant Access to Users and Groups](/manage-access/grant-access-to-users-and-groups/).
- Read [Troubleshoot Access](/manage-access/troubleshoot-access/).
- Browse the [generated auth command reference](/reference/generated/cli/auth/).
