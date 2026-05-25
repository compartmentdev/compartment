---
title: Single Sign-On
description: Configure organization-level OIDC sign-in providers.
---

Compartment ships organization-scoped OIDC SSO management:

```bash
compartment sso oidc list
compartment sso oidc add
compartment sso oidc update <providerId>
compartment sso oidc remove <providerId>
```

Use this surface to configure:

- issuer URL and preset;
- client ID and client secret;
- provider display and button text;
- identity verification claims;
- requested scopes;
- optional auto-join provisioning rules such as allowed email domains and the default role for first-time SSO users.

For a custom OIDC provider, the issuer and authorization endpoint must use HTTPS and must not include URL credentials. If the authorization endpoint host is not one of the built-in trusted OIDC hosts, add that host to `COMPARTMENT_TRUSTED_OUTBOUND_HOSTS` in the install environment before users start browser SSO login.

This SSO surface is organization-level. It does not replace install-level runtime operations.

Identity verification can read email and verification claims from the ID token and UserInfo response. When a boolean verified-email claim comes from a different source than the selected email, that source must also expose the same email value. If it does not, Compartment treats the selected email as unverified, so flows that require a verified email, including auto-join, do not proceed for that login.

Human CLI login now always starts with a browser handoff:

```bash
compartment login --api-url <control-plane-url>
```

The CLI prints a verification URL and waits for the browser flow to finish. `--email <email>` is optional and only pre-fills the browser form. If the selected organization disables local passwords and exposes a single SSO provider, the browser `/login` flow can redirect straight into that provider. If local passwords stay enabled, the same browser flow still owns the choice between password and SSO.

If an invited user signs in through SSO first, Compartment links that login to the existing invited member, and the role from the invite takes priority over the provider's auto-join default role.

An OIDC sign-in session only exposes the organization that owns the provider used for that login. If the same person is a member of another organization, they must sign in through that organization's allowed login method before the browser control plane or CLI session can show it.

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Read [Access, Organizations, Users, and Roles](/manage-access/access-organizations-users-and-roles/).
- Browse the [generated SSO command reference](/reference/generated/cli/sso/).
