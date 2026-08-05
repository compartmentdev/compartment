---
title: Operate a Managed VM
description: Check, update, diagnose, recover, and remove a Compartment-managed VM installation.
---

Use these commands only on a VM provisioned by `compartment install --target vm`. Existing Kubernetes clusters keep
their operator-managed lifecycle.

During initial provisioning, Compartment automatically installs cert-manager, creates the internal registry CA and
Issuer, adds the CA to the managed node trust store, and installs gVisor/runsc. These are managed host components;
do not pre-create an issuer, patch node trust, or install the runtime before installation.

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
curl -fsSL https://compartment.dev/install.sh | sh
sudo compartment system update
```

First install the current verified stable CLI. The update command verifies the installer-owned host content, creates
an etcd snapshot, invokes the canonical platform update, and verifies the resulting host and cluster versions plus a
real gVisor canary. It does not adopt or rewrite an older installer-owned release: when the recorded release metadata
differs, the command fails closed and requires an explicit managed-VM reset and clean reinstall. That reset permanently
removes the managed cluster, platform, and application data as described below.
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
gVisor binaries and containerd configuration, firewall rules, and CA trust recorded as Compartment-owned. A normal
Helm uninstall does not destroy the host cluster.
