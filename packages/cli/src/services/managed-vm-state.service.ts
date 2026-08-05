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
import { managedVmSandboxRuntimePaths } from './managed-vm-sandbox-runtime.constants';

export const managedVmStateDirectory: string = '/var/lib/compartment/installer';
const managedVmStatePath: string = `${managedVmStateDirectory}/state.json`;
type ManagedVmOwnedPathFilter = (ownedPath: ManagedVmOwnedPath) => boolean;
export const managedVmLegacyOwnedPaths: readonly ManagedVmOwnedPath[] = [
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
];

export const managedVmPreviousOwnedPaths: readonly ManagedVmOwnedPath[] = [
  ...managedVmLegacyOwnedPaths,
  { path: managedVmSandboxRuntimePaths.runsc, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.containerdShim, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.gvisorBinDirectory, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.runscConfig, stage: 'installing-sandbox-runtime' },
  {
    path: managedVmSandboxRuntimePaths.containerdTemplate,
    stage: 'installing-sandbox-runtime',
  },
];

export const managedVmOwnedPaths: readonly ManagedVmOwnedPath[] = [
  ...managedVmPreviousOwnedPaths,
  { path: managedVmSandboxRuntimePaths.checkpointGofer, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.metricServer, stage: 'installing-sandbox-runtime' },
];

export function managedVmOwnedPathsEqual(
  left: readonly ManagedVmOwnedPath[],
  right: readonly ManagedVmOwnedPath[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
  expectedOwnedFileDigests?: Readonly<Record<string, string>>,
): Promise<ManagedVmProvisionerState> {
  const stageOwnedFileDigests: Readonly<Record<string, string>> = await collectManagedVmStageOwnedFileDigests(
    state,
    completedStage,
  );
  if (
    expectedOwnedFileDigests !== undefined &&
    !ownedFileDigestsEqual(stageOwnedFileDigests, expectedOwnedFileDigests)
  ) {
    throw new Error('Managed-VM installer-written content changed before ownership could be persisted.');
  }
  const next: ManagedVmProvisionerState = {
    ...state,
    completedStage,
    ownedFileDigests: { ...state.ownedFileDigests, ...stageOwnedFileDigests },
    updatedAt: new Date().toISOString(),
  };
  await writeStateAtomically(next);
  return next;
}

function ownedFileDigestsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const ordered: (value: Readonly<Record<string, string>>) => readonly [string, string][] = (
    value: Readonly<Record<string, string>>,
  ): readonly [string, string][] =>
    Object.entries(value).sort(([leftPath]: [string, string], [rightPath]: [string, string]): number =>
      leftPath.localeCompare(rightPath),
    );
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
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

async function collectManagedVmStageOwnedFileDigests(
  state: ManagedVmProvisionerState,
  completedStage: ManagedVmInstallStage,
): Promise<Readonly<Record<string, string>>> {
  return await collectManagedVmOwnedFileDigestsWhere(
    state,
    (ownedPath: ManagedVmOwnedPath): boolean => ownedPath.stage === completedStage,
  );
}

async function collectManagedVmOwnedFileDigests(
  state: ManagedVmProvisionerState,
  completedStage: ManagedVmInstallStage,
): Promise<Readonly<Record<string, string>>> {
  return await collectManagedVmOwnedFileDigestsWhere(state, (ownedPath: ManagedVmOwnedPath): boolean =>
    isManagedVmInstallStageComplete(completedStage, ownedPath.stage),
  );
}

async function collectManagedVmOwnedFileDigestsWhere(
  state: ManagedVmProvisionerState,
  include: ManagedVmOwnedPathFilter,
): Promise<Readonly<Record<string, string>>> {
  const entries: [string, string][] = [];
  for (const ownedPath of state.ownedPaths) {
    if (!include(ownedPath)) {
      continue;
    }
    const ownership: string | undefined = await readOwnedPathIdentity(
      ownedPath.path,
      state.releaseMetadata.metadataVersion,
    );
    if (ownership !== undefined) {
      entries.push([ownedPath.path, ownership]);
    }
  }
  return Object.fromEntries(entries);
}

async function readOwnedPathIdentity(path: string, metadataVersion: number): Promise<string | undefined> {
  try {
    const details: Stats = await lstat(path);
    if (details.isDirectory()) {
      return 'directory';
    }
    if (!details.isFile()) {
      throw new Error(`Managed-VM owned path has an unsupported type: ${path}`);
    }
    const content: Buffer = await readFile(path);
    return metadataVersion >= 3 ? managedVmFileIdentity(content, details.mode) : digest(content);
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

export function managedVmFileIdentity(content: string | Buffer, mode: number): string {
  return `file:${(mode & 0o7777).toString(8).padStart(4, '0')}:${digest(content)}`;
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
