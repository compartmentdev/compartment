---
title: Install Domain
description: Manage the install-level base domain for the control plane and hosted routes.
---

Compartment uses one install-level base domain for:

- `console.<baseDomain>`
- hosted app routes under `*.<baseDomain>`

There are two main domain models:

- managed-domain install: the broker allocates the base domain and Caddy obtains the wildcard certificate on the self-hosted runtime host;
- operator-owned install domain: you stage, verify, and activate the install domain yourself.

In the default managed mode, `compartment install` asks the managed-domain broker to allocate this install domain automatically.

## Stage an operator-owned domain

```bash
sudo compartment system domain set --base-domain customer.example.com --tls external --public-scheme https
sudo compartment system domain verify
sudo compartment system domain activate
sudo compartment system domain status
```

Use `--tls custom-cert` when you will attach your own certificate material.

Browser login and hosted-app access require HTTPS public URLs because Compartment uses host-bound secure cookies for platform sessions. Legacy HTTP runtime domain settings remain readable so operators can migrate them to HTTPS.

Activation restarts the self-hosted runtime. For registry image sources, Compartment verifies runtime image signatures with `cosign` before starting containers.

## Return to the managed domain

```bash
sudo compartment system domain reset-managed
```

That reuses the managed-domain metadata already stored by the install. It does not allocate a new broker domain. The reset also restarts the runtime and uses the same registry signature verification as other runtime restarts.

Next steps:

- Read [System Operations](/install-operate/system-operations/).
- Read [Custom Domains for Apps](/deploy-apps/custom-domains-for-apps/).
