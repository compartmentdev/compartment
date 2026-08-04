import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import type {
  ManagedVmInstallStage,
  ManagedVmOwnedPath,
  ManagedVmProvisionerState,
  ManagedVmUpdateState,
} from './managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { isManagedVmInstallStageComplete } from './managed-vm-stage.service';
import { parseManagedVmState } from './managed-vm-state-validation.service';

export const managedVmStateDirectory: string = '/var/lib/compartment/installer';
const managedVmStatePath: string = `${managedVmStateDirectory}/state.json`;
export const managedVmOwnedPaths: readonly ManagedVmOwnedPath[] = [
  { path: '/etc/compartment', stage: 'preparing-host' },
  { path: '/etc/compartment/firewall.nft', stage: 'preparing-host' },
  { path: '/etc/compartment/registry-ca.key', stage: 'preparing-host' },
  { path: '/etc/compartment/values.yaml', stage: 'preparing-host' },
  { path: '/etc/rancher/k3s', stage: 'preparing-host' },
  { path: '/etc/rancher/k3s/config.yaml', stage: 'preparing-host' },
  { path: '/usr/local/bin/helm', stage: 'preparing-host' },
  { path: '/usr/local/bin/compartment', stage: 'preparing-host' },
  { path: '/usr/local/share/ca-certificates/compartment-registry-ca.crt', stage: 'preparing-host' },
  { path: '/etc/systemd/system/compartment-firewall.service', stage: 'preparing-host' },
  { path: '/usr/local/bin/k3s', stage: 'installing-k3s' },
  { path: '/usr/local/bin/k3s-killall.sh', stage: 'installing-k3s' },
  { path: '/usr/local/bin/k3s-uninstall.sh', stage: 'installing-k3s' },
  { path: '/etc/systemd/system/k3s.service', stage: 'installing-k3s' },
  { path: '/etc/systemd/system/k3s.service.env', stage: 'installing-k3s' },
  { path: '/etc/systemd/system/k3s.service.d', stage: 'installing-k3s' },
  { path: '/etc/systemd/system/k3s.service.d/compartment.conf', stage: 'installing-k3s' },
  { path: '/run/flannel', stage: 'installing-k3s' },
  { path: '/run/k3s', stage: 'installing-k3s' },
  { path: '/var/lib/kubelet', stage: 'installing-k3s' },
  { path: '/var/lib/rancher/k3s', stage: 'installing-k3s' },
  { path: '/usr/local/bin/runsc', stage: 'installing-sandbox-runtime' },
  { path: '/usr/local/bin/containerd-shim-runsc-v1', stage: 'installing-sandbox-runtime' },
  { path: '/usr/local/bin/gvisor-bin', stage: 'installing-sandbox-runtime' },
  { path: '/etc/containerd/runsc.toml', stage: 'installing-sandbox-runtime' },
  {
    path: '/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl',
    stage: 'installing-sandbox-runtime',
  },
];

export async function readManagedVmState(): Promise<ManagedVmProvisionerState | undefined> {
  try {
    return parseManagedVmState(await readFile(managedVmStatePath, 'utf8'));
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }
    if (error instanceof Error && isPermissionDenied(error)) {
      throw new Error(`Managed-VM state at ${managedVmStatePath} is root-owned; rerun this command with sudo.`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function createManagedVmState(config: string): Promise<ManagedVmProvisionerState> {
  const now: string = new Date().toISOString();
  const state: ManagedVmProvisionerState = {
    completedStage: 'pending',
    configDigest: digest(config),
    installationId: randomUUID(),
    metadataDigest: digest(JSON.stringify(managedVmReleaseMetadata)),
    ownedFileDigests: {},
    ownedPaths: managedVmOwnedPaths,
    releaseMetadata: managedVmReleaseMetadata,
    resolvedArtifacts: managedVmReleaseMetadata.artifacts,
    startedAt: now,
    updatedAt: now,
  };
  await writeStateAtomically(state);
  return state;
}

export async function persistManagedVmUpdate(
  state: ManagedVmProvisionerState,
  update: ManagedVmUpdateState,
): Promise<ManagedVmProvisionerState> {
  const next: ManagedVmProvisionerState = { ...state, update, updatedAt: new Date().toISOString() };
  await writeStateAtomically(next);
  return next;
}

export async function completeManagedVmReleaseUpdate(
  state: ManagedVmProvisionerState,
  update: ManagedVmUpdateState,
): Promise<ManagedVmProvisionerState> {
  const next: ManagedVmProvisionerState = {
    ...state,
    metadataDigest: digest(JSON.stringify(managedVmReleaseMetadata)),
    releaseMetadata: managedVmReleaseMetadata,
    resolvedArtifacts: managedVmReleaseMetadata.artifacts,
    update,
    updatedAt: new Date().toISOString(),
  };
  await writeStateAtomically(next);
  return next;
}

export async function persistManagedVmStage(
  state: ManagedVmProvisionerState,
  completedStage: ManagedVmInstallStage,
): Promise<ManagedVmProvisionerState> {
  const next: ManagedVmProvisionerState = {
    ...state,
    completedStage,
    ownedFileDigests: await collectManagedVmOwnedFileDigests(state, completedStage),
    updatedAt: new Date().toISOString(),
  };
  await writeStateAtomically(next);
  return next;
}

export async function recordManagedVmOwnedFileDigests(
  state: ManagedVmProvisionerState,
): Promise<ManagedVmProvisionerState> {
  const adoptedState: ManagedVmProvisionerState = { ...state, ownedPaths: managedVmOwnedPaths };
  const next: ManagedVmProvisionerState = {
    ...adoptedState,
    ownedFileDigests: await collectManagedVmOwnedFileDigests(adoptedState, state.completedStage),
    updatedAt: new Date().toISOString(),
  };
  await writeStateAtomically(next);
  return next;
}

export async function assertManagedVmOwnedFileDigests(state: ManagedVmProvisionerState): Promise<void> {
  const observed: Readonly<Record<string, string>> = await collectManagedVmOwnedFileDigests(
    state,
    state.completedStage,
  );
  if (JSON.stringify(observed) !== JSON.stringify(state.ownedFileDigests)) {
    throw new Error('Managed-VM owned host content has changed; refusing to overwrite or remove it.');
  }
}

async function writeStateAtomically(state: ManagedVmProvisionerState): Promise<void> {
  const temporaryPath: string = `${managedVmStatePath}.${String(process.pid)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, managedVmStatePath);
}

async function collectManagedVmOwnedFileDigests(
  state: ManagedVmProvisionerState,
  completedStage: ManagedVmInstallStage,
): Promise<Readonly<Record<string, string>>> {
  const entries: [string, string][] = [];
  for (const ownedPath of state.ownedPaths) {
    if (!isManagedVmInstallStageComplete(completedStage, ownedPath.stage)) {
      continue;
    }
    const ownership: string | undefined = await readOwnedPathIdentity(ownedPath.path);
    if (ownership !== undefined) {
      entries.push([ownedPath.path, ownership]);
    }
  }
  return Object.fromEntries(entries);
}

async function readOwnedPathIdentity(path: string): Promise<string | undefined> {
  try {
    const details: Stats = await lstat(path);
    if (details.isDirectory()) {
      return 'directory';
    }
    if (!details.isFile()) {
      throw new Error(`Managed-VM owned path has an unsupported type: ${path}`);
    }
    return digest(await readFile(path));
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

export function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

function isPermissionDenied(error: Error): boolean {
  return 'code' in error && error.code === 'EACCES';
}
