---
title: Install Compartment
description: Install the CLI, bring up the self-hosted system, and log into it from other machines.
---

Use this flow when you are creating a new Compartment runtime.

Compartment has two install steps:

- install the CLI on the machine you are using;
- install the Compartment system on the target server.

## 1. Install the CLI

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

The public bootstrapper installs the CLI only by default.

If you are already on the target server and want the installer to continue directly into system setup, use:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install
```

## 2. Install the system on the target server

The current shipped system install command is:

```bash
compartment install
```

That command requires the CLI to already exist on the server. When you run the bootstrapper with `--init-install`, it installs the CLI first and then starts this same command.

Default registry installs verify runtime image signatures with the bundled CLI verifier before they activate runtime files or start containers. If verification fails, rerun the install after upgrading to a matching CLI or fixing the published image signatures; the install directory stays retryable.

The install creates a host service named `compartment-node-agent.service`. This service is used for deployments, logs,
resource lifecycle operations, and runtime network cleanup. Install and update it with the packaged Compartment CLI for
the runtime version you are running.

## 3. Complete the install prompts

The install flow asks for:

- the first admin email;
- the first organization name;
- the first admin password;
- public HTTP and HTTPS ports.

By default, `compartment install` uses the production managed-domain broker. Use `--base-domain`, `--local-runtime`, or `--dev` when you need an explicit non-managed-domain mode.

If you use `compartment install --dev` on a machine that already talks to other Compartment installs, pass `--remote <name>` to keep the local dev session under its own remote profile:

```bash
compartment install --dev --remote local-dev
```

## 4. Check runtime status

```bash
sudo compartment system status
```

After install, the command prints the active Console URL and a `Login your CLI on this server` block.

## 5. Log in from another machine

On another machine, install the CLI and then use `compartment login` against the existing control-plane URL when that URL uses a certificate trusted by the machine:

```bash
compartment login --api-url https://console.example.com --organization acme-dev
```

Pass `--email <email>` only when you want the browser login form prefilled for a specific user.

If the same machine talks to more than one install, name the remote profile during login:

```bash
compartment login --remote prod-eu --api-url https://console.example.com
```

If you want the public bootstrapper to install the CLI and immediately start the login flow, use:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url https://console.example.com
```

The installer prompts for the email address. For non-interactive automation, pass `--email <email>`.

Automation note: treat the install and system surfaces as contract-bound. Use the documented CLI flags and published responses, and do not depend on internal probe or control-plane routes that are not part of the public install workflow.

Next steps:

- Read [Install Modes](/install-operate/install-modes/).
- Read [Install Domain](/install-operate/install-domain/).
- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
