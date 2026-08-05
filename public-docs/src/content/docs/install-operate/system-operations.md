---
title: System Operations
description: Check, restart, update, and manage domains for a Compartment Kubernetes installation.
---

Compartment provides the same platform lifecycle commands for managed-VM and existing-Kubernetes installations:

```bash
compartment system status
compartment system restart
```

`system status` reports the Helm release and platform workload readiness. `system restart` rolls the platform
workloads and waits for readiness; it does not restart Kubernetes nodes.

## Update the platform

Install the current verified stable CLI before updating:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

For an existing Kubernetes cluster, pass the same operator values file used for the installation:

```bash
compartment system update \
  --kube-context production \
  --values compartment-values.yaml
```

The command verifies the target images, updates the Helm release, runs database migrations, and waits for platform
readiness. Your cluster, ingress controller, storage system, and node lifecycle remain operator-owned.

On a Compartment-managed VM, run:

```bash
sudo compartment system update
```

That path verifies the Compartment-owned k3s and gVisor runtime, creates a local etcd snapshot, and updates the
platform through resumable stages. It fails closed when the recorded installer-owned release metadata differs and
then requires reprovisioning a clean VM; it does not automatically delete generated K3s host files. See
[Operate a Managed VM](/guides/operate-managed-vm/) for diagnostics, recovery, backup limits, and reprovisioning.

## Manage the install domain

Inspect or change the install-level domain with:

```bash
compartment system domain status
compartment system domain set --base-domain apps.example.com --values compartment-values.yaml
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

Use [Install Domain](/install-operate/install-domain/) to choose the DNS and TLS ownership model. App-specific aliases
use the separate `compartment domain` commands.

Next steps:

- Browse the [generated system command reference](/reference/generated/cli/system/).
- Read [Deployment Lifecycle](/deploy-apps/deployment-lifecycle/).
