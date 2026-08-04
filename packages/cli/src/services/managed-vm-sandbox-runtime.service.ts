import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { verifyKubernetesSandboxRuntime } from './kubernetes-sandbox-runtime-preflight.service';

const containerdTemplatePath: string = '/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl';
const gvisorBinDirectory: string = '/usr/local/bin/gvisor-bin';
const gvisorContainerdShimPath: string = '/usr/local/bin/containerd-shim-runsc-v1';
const gvisorRuntimeClassName: string = 'gvisor';
const gvisorRunscPath: string = '/usr/local/bin/runsc';
const runscConfigPath: string = '/etc/containerd/runsc.toml';

export async function installManagedVmSandboxRuntime(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await installGvisorFiles(artifacts);
  await writeContainerdConfiguration();
  await execa('systemctl', ['restart', 'k3s']);
  await execa('k3s', ['kubectl', 'wait', 'node', '--all', '--for=condition=Ready', '--timeout=5m']);
  await applyManagedVmRuntimeClass();
  await verifyManagedVmSandboxRuntime();
}

export async function isManagedVmSandboxRuntimeHealthy(): Promise<boolean> {
  try {
    await verifyManagedVmSandboxRuntime();
    return true;
  } catch {
    return false;
  }
}

export async function verifyManagedVmSandboxRuntime(): Promise<void> {
  const version: ManagedVmCommandResult = await execa(gvisorRunscPath, ['--version']);
  if (!version.stdout.includes(managedVmReleaseMetadata.gvisorVersion)) {
    throw new Error('Managed-VM gVisor version verification failed.');
  }
  const containerdConfig: string = await readFile('/var/lib/rancher/k3s/agent/etc/containerd/config.toml', 'utf8');
  if (!containerdConfig.includes('io.containerd.runsc.v1') || !containerdConfig.includes(runscConfigPath)) {
    throw new Error('Managed-VM K3s containerd did not register the runsc runtime handler.');
  }
  await verifyKubernetesSandboxRuntime({
    kubeContext: 'default',
    kubeconfigPath: '/etc/rancher/k3s/k3s.yaml',
    runtimeClassName: gvisorRuntimeClassName,
  });
}

async function installGvisorFiles(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await Promise.all([
    copyFile(artifacts.gvisorRunscPath, gvisorRunscPath),
    copyFile(artifacts.gvisorContainerdShimPath, gvisorContainerdShimPath),
  ]);
  await rm(gvisorBinDirectory, { force: true, recursive: true });
  await cp(artifacts.gvisorBinDirectory, gvisorBinDirectory, { recursive: true });
  await Promise.all([chmod(gvisorRunscPath, 0o755), chmod(gvisorContainerdShimPath, 0o755)]);
}

async function writeContainerdConfiguration(): Promise<void> {
  await Promise.all([
    mkdir('/etc/containerd', { mode: 0o755, recursive: true }),
    mkdir('/var/lib/rancher/k3s/agent/etc/containerd', { mode: 0o700, recursive: true }),
  ]);
  await writeFile(runscConfigPath, '[runsc_config]\n', { mode: 0o600 });
  await writeFile(containerdTemplatePath, renderContainerdTemplate(), { mode: 0o600 });
}

async function applyManagedVmRuntimeClass(): Promise<void> {
  await execa('k3s', ['kubectl', 'apply', '--filename', '-'], { input: renderRuntimeClass() });
}

function renderContainerdTemplate(): string {
  return `{{ template "base" . }}

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "${runscConfigPath}"
`;
}

function renderRuntimeClass(): string {
  return `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: ${gvisorRuntimeClassName}
handler: runsc
`;
}
