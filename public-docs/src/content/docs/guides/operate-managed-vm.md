---
title: Operate a Managed VM
description: Check, update, diagnose, recover, and remove a Compartment-managed VM installation.
---

Use these commands only on a VM provisioned by `compartment install --target vm`. Existing Kubernetes clusters keep
their operator-managed lifecycle.

## Check status

```bash
sudo compartment system status
```

Status combines the host provisioner stage, k3s service and version, Kubernetes readiness, and the Compartment Helm
release. After a reboot, wait for this command to report k3s and the platform as ready before deploying.

## Create diagnostics

```bash
sudo compartment system diagnose
```

The command creates a local compressed support bundle with provisioner state, service status, node readiness, and
platform workload status. Credentials, bearer tokens, kubeconfig key data, and Secret values are excluded or
redacted. Review the archive before sharing it.

## Update

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --channel main
sudo compartment system update
```

First install the current verified `main`-channel CLI. Its signed provisioning metadata selects the tested target
release and artifacts. The update command verifies those artifacts, creates an etcd snapshot, advances k3s and cert-manager
through durable stages, invokes the canonical platform update, and verifies the resulting host and cluster versions.
Managed Kubernetes components do not update in the background. If an update stops, correct the reported problem and
rerun the same command.

Scheduled local etcd snapshots protect against some operator errors. They are stored on the same VM and are not a
machine-loss backup. Copy verified backups and application data off-host according to your recovery requirements.

## Recover an interrupted installation

Rerun the original install command with `sudo`. Durable stages resume under the same installation identity after the installer
revalidates owned state. The installer never removes a retained cluster automatically after a failure.

## Destroy the provisioned cluster

First read the installation ID from `sudo compartment system status`. Then run:

```bash
sudo compartment system reset \
  --destroy-provisioned-cluster \
  --confirm-installation <installation-id>
```

This permanently removes the managed cluster, platform and application data, and only the host files, services,
firewall rules, and CA trust recorded as Compartment-owned. A normal Helm uninstall does not destroy the host cluster.
