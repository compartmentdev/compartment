import { lstat, open, readFile, rename, unlink, type FileHandle } from 'node:fs/promises';
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
import { managedVmK3sGeneratedOwnedPaths } from './managed-vm-install-paths.service';

export const managedVmStateDirectory: string = '/var/lib/compartment/installer';
const managedVmStatePath: string = `${managedVmStateDirectory}/state.json`;
type ManagedVmOwnedPathFilter = (ownedPath: ManagedVmOwnedPath) => boolean;
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
  { path: '/etc/systemd/system/k3s.service.d', stage: 'installing-k3s' },
  { path: '/etc/systemd/system/k3s.service.d/compartment.conf', stage: 'installing-k3s' },
  ...managedVmK3sGeneratedOwnedPaths.map((path: string): ManagedVmOwnedPath => ({ path, stage: 'installing-k3s' })),
  { path: managedVmSandboxRuntimePaths.runsc, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.containerdShim, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.gvisorBinDirectory, stage: 'installing-sandbox-runtime' },
  { path: managedVmSandboxRuntimePaths.runscConfig, stage: 'installing-sandbox-runtime' },
  {
    path: managedVmSandboxRuntimePaths.containerdTemplate,
    stage: 'installing-sandbox-runtime',
  },
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
  expectedOwnedFileDigests: Readonly<Record<string, string>>,
): Promise<ManagedVmProvisionerState> {
  assertExpectedStageOwnedPaths(state, completedStage, expectedOwnedFileDigests);
  await assertManagedVmOwnedFileDigests(state);
  const stageOwnedFileDigests: Readonly<Record<string, string>> = await collectManagedVmStageOwnedFileDigests(
    state,
    completedStage,
  );
  if (!ownedFileDigestsEqual(stageOwnedFileDigests, expectedOwnedFileDigests)) {
    throw new Error('Managed-VM installer-written content changed before ownership could be persisted.');
  }
  const next: ManagedVmProvisionerState = {
    ...state,
    completedStage,
    ownedFileDigests: { ...state.ownedFileDigests, ...expectedOwnedFileDigests },
    updatedAt: new Date().toISOString(),
  };
  await writeStateAtomically(next);
  return next;
}

function assertExpectedStageOwnedPaths(
  state: ManagedVmProvisionerState,
  completedStage: ManagedVmInstallStage,
  expectedOwnedFileDigests: Readonly<Record<string, string>>,
): void {
  const manifestPaths: string[] = state.ownedPaths
    .filter((ownedPath: ManagedVmOwnedPath): boolean => ownedPath.stage === completedStage)
    .map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path)
    .sort((left: string, right: string): number => left.localeCompare(right));
  const expectedPaths: string[] = Object.keys(expectedOwnedFileDigests).sort((left: string, right: string): number =>
    left.localeCompare(right),
  );
  if (JSON.stringify(manifestPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('Managed-VM installer-written ownership does not match the current stage manifest.');
  }
}

export async function assertManagedVmOwnedFileDigests(state: ManagedVmProvisionerState): Promise<void> {
  const observed: Readonly<Record<string, string>> = await collectManagedVmOwnedFileDigests(
    state,
    state.completedStage,
  );
  if (!ownedFileDigestsEqual(observed, state.ownedFileDigests)) {
    throw new Error('Managed-VM owned host content has changed; refusing to overwrite or remove it.');
  }
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

async function writeStateAtomically(state: ManagedVmProvisionerState): Promise<void> {
  const temporaryPath: string = `${managedVmStatePath}.${String(process.pid)}.tmp`;
  const handle: FileHandle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, undefined, 2)}\n`);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, managedVmStatePath);
  } catch (error) {
    await handle.close().catch((): void => undefined);
    await unlink(temporaryPath).catch((): void => undefined);
    throw error;
  }
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
    const ownership: string | undefined = await readManagedVmPathIdentity(
      ownedPath.path,
      state.releaseMetadata.metadataVersion,
    );
    if (ownership !== undefined) {
      entries.push([ownedPath.path, ownership]);
    }
  }
  return Object.fromEntries(entries);
}

export async function readManagedVmPathIdentity(path: string, metadataVersion: number): Promise<string | undefined> {
  try {
    const details: Stats = await lstat(path);
    if (details.isDirectory()) {
      return metadataVersion >= 3 ? managedVmDirectoryIdentity(details) : 'directory';
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

export function managedVmDirectoryIdentity(details: Pick<Stats, 'gid' | 'mode' | 'uid'>): string {
  return `directory:${String(details.uid)}:${String(details.gid)}:${(details.mode & 0o7777).toString(8).padStart(4, '0')}`;
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
