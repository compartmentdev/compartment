import { readdir, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { verifyManagedVmComponentVersions } from './managed-vm-cluster.service';
import { removeManagedVmFirewall } from './managed-vm-firewall.service';
import type { ManagedVmResetInput, ManagedVmSystemStatus } from './managed-vm-lifecycle.service.types';
import type {
  ManagedVmOwnedPath,
  ManagedVmProvisionerState,
  ManagedVmUpdateState,
} from './managed-vm-provisioning.types';
import {
  assertManagedVmOwnedFileDigests,
  completeManagedVmReleaseUpdate,
  digest,
  managedVmStateDirectory,
  managedVmLegacyOwnedPaths,
  managedVmOwnedPaths,
  managedVmPreviousOwnedPaths,
  managedVmOwnedPathsEqual,
  persistManagedVmUpdate,
  readManagedVmState,
} from './managed-vm-state.service';
import { acquireManagedVmLock } from './managed-vm-lock.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { removeManagedVmOwnedPaths } from './managed-vm-owned-paths.service';
import { isManagedVmInstallStageComplete, isManagedVmUpdateStageComplete } from './managed-vm-stage.service';
import { verifyManagedVmSandboxRuntime } from './managed-vm-sandbox-runtime.service';
import {
  managedVmSandboxRuntimeHelperNames,
  managedVmSandboxRuntimePaths,
} from './managed-vm-sandbox-runtime.constants';

export async function getManagedVmSystemStatus(): Promise<ManagedVmSystemStatus> {
  const state: ManagedVmProvisionerState = await requireManagedVmState();
  const active: ManagedVmCommandResult = await execa('systemctl', ['is-active', 'k3s.service'], { reject: false });
  const version: ManagedVmCommandResult = await execa('k3s', ['--version'], { reject: false });
  return {
    installationId: state.installationId,
    k3sActive: active.exitCode === 0,
    k3sVersion: version.exitCode === 0 && version.stdout.trim() !== '' ? version.stdout.split('\n')[0]! : 'unavailable',
    provisionerStage: state.completedStage,
  };
}

export async function updateManagedVmInstallation<TResult>(
  updatePlatform: () => Promise<TResult>,
  readPlatformResult: () => Promise<TResult>,
): Promise<TResult> {
  const releaseLock: () => Promise<void> = await acquireManagedVmLock();
  try {
    let state: ManagedVmProvisionerState = await prepareManagedVmUpdate();
    const platformAlreadyUpdated: boolean = isManagedVmUpdateStageComplete(
      requireManagedVmUpdate(state).stage,
      'platform-updated',
    );
    const result: TResult = platformAlreadyUpdated ? await readPlatformResult() : await updatePlatform();
    if (!platformAlreadyUpdated) {
      state = await markManagedVmPlatformUpdated(state);
    }
    await verifyAndCompleteManagedVmUpdate(state);
    return result;
  } finally {
    await releaseLock();
  }
}

export async function resetManagedVmInstallation(input: ManagedVmResetInput): Promise<void> {
  const releaseLock: () => Promise<void> = await acquireManagedVmLock();
  try {
    const state: ManagedVmProvisionerState = await requireManagedVmState();
    assertResetConfirmation(input, state);
    assertOwnedManifest(state);
    assertOwnedRelease(state);
    await assertManagedVmOwnedFileDigests(state);
    await assertResetSandboxRuntimePathsAreSafe(state);
    await executeManagedVmReset(state);
  } finally {
    await releaseLock();
  }
}

async function prepareManagedVmUpdate(): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState = await requireManagedVmState();
  assertOwnedManifest(state);
  assertOwnedRelease(state);
  await assertManagedVmOwnedFileDigests(state);
  assertCurrentManagedVmRelease(state);
  state = await beginManagedVmUpdate(state);
  state = await installManagedVmUpdateComponents(state);
  if (!isManagedVmUpdateStageComplete(requireManagedVmUpdate(state).stage, 'components-installed')) {
    throw new Error('Managed-VM update has not completed its verified component stage.');
  }
  await verifyManagedVmSandboxRuntime();
  return state;
}

async function markManagedVmPlatformUpdated(state: ManagedVmProvisionerState): Promise<ManagedVmProvisionerState> {
  const update: ManagedVmUpdateState = {
    ...requireManagedVmUpdate(state),
    stage: 'platform-updated',
    updatedAt: new Date().toISOString(),
  };
  return await persistManagedVmUpdate(state, update);
}

async function verifyAndCompleteManagedVmUpdate(state: ManagedVmProvisionerState): Promise<void> {
  await verifyManagedVmComponentVersions();
  await verifyManagedVmSandboxRuntime();
  const update: ManagedVmUpdateState = {
    ...requireManagedVmUpdate(state),
    stage: 'verified',
    updatedAt: new Date().toISOString(),
  };
  await completeManagedVmReleaseUpdate(state, update);
}

async function executeManagedVmReset(state: ManagedVmProvisionerState): Promise<void> {
  if (!isManagedVmInstallStageComplete(state.completedStage, 'preparing-host')) {
    throw new Error('Managed-VM reset refuses state that has no completed owned mutation stage.');
  }
  if (isManagedVmInstallStageComplete(state.completedStage, 'installing-k3s')) {
    await execa('/usr/local/bin/k3s-uninstall.sh', []);
  }
  await removeManagedVmFirewall();
  await removeOwnedManagedVmPaths(state);
  await rm(managedVmStateDirectory, { force: true, recursive: true });
  await execa('update-ca-certificates', []);
  await execa('systemctl', ['daemon-reload']);
}

function assertResetConfirmation(input: ManagedVmResetInput, state: ManagedVmProvisionerState): void {
  if (input.confirmation !== state.installationId) {
    throw new Error(`Destructive reset requires the exact installation ID: ${state.installationId}`);
  }
}

async function beginManagedVmUpdate(state: ManagedVmProvisionerState): Promise<ManagedVmProvisionerState> {
  const now: string = new Date().toISOString();
  let update: ManagedVmUpdateState =
    state.update?.metadataDigest === currentMetadataDigest() && state.update.stage !== 'verified'
      ? state.update
      : { metadataDigest: currentMetadataDigest(), stage: 'preflight', startedAt: now, updatedAt: now };
  state = await persistManagedVmUpdate(state, update);
  if (isManagedVmUpdateStageComplete(update.stage, 'snapshot-created')) {
    return state;
  }
  const snapshotName: string = `compartment-update-${now}`;
  await execa('k3s', ['etcd-snapshot', 'save', '--name', snapshotName]);
  update = { ...update, snapshotName, stage: 'snapshot-created', updatedAt: new Date().toISOString() };
  return await persistManagedVmUpdate(state, update);
}

async function installManagedVmUpdateComponents(state: ManagedVmProvisionerState): Promise<ManagedVmProvisionerState> {
  const update: ManagedVmUpdateState = requireManagedVmUpdate(state);
  if (isManagedVmUpdateStageComplete(update.stage, 'components-installed')) {
    return state;
  }
  await verifyManagedVmComponentVersions();
  return await persistManagedVmUpdate(state, {
    ...update,
    stage: 'components-installed',
    updatedAt: new Date().toISOString(),
  });
}

function requireManagedVmUpdate(state: ManagedVmProvisionerState): ManagedVmUpdateState {
  if (state.update === undefined) {
    throw new Error('Managed-VM update state is missing.');
  }
  return state.update;
}

async function removeOwnedManagedVmPaths(state: ManagedVmProvisionerState): Promise<void> {
  const completedPaths: string[] = state.ownedPaths
    .filter((ownedPath: ManagedVmOwnedPath): boolean =>
      isManagedVmInstallStageComplete(state.completedStage, ownedPath.stage),
    )
    .map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path);
  if (
    state.releaseMetadata.metadataVersion === 2 &&
    isManagedVmInstallStageComplete(state.completedStage, 'installing-sandbox-runtime')
  ) {
    completedPaths.push(managedVmSandboxRuntimePaths.checkpointGofer, managedVmSandboxRuntimePaths.metricServer);
  }
  await removeManagedVmOwnedPaths(completedPaths);
}

function assertOwnedManifest(state: ManagedVmProvisionerState): void {
  const expected: readonly ManagedVmOwnedPath[] = expectedOwnedPaths(state);
  if (!managedVmOwnedPathsEqual(state.ownedPaths, expected)) {
    throw new Error('Managed-VM ownership manifest is invalid; refusing lifecycle mutation.');
  }
}

function expectedOwnedPaths(state: ManagedVmProvisionerState): readonly ManagedVmOwnedPath[] {
  if (state.releaseMetadata.metadataVersion === 1) {
    return managedVmLegacyOwnedPaths;
  }
  if (state.releaseMetadata.metadataVersion === 2) {
    return managedVmPreviousOwnedPaths;
  }
  return managedVmOwnedPaths;
}

async function assertResetSandboxRuntimePathsAreSafe(state: ManagedVmProvisionerState): Promise<void> {
  if (
    state.releaseMetadata.metadataVersion === 1 ||
    !isManagedVmInstallStageComplete(state.completedStage, 'installing-sandbox-runtime')
  ) {
    return;
  }
  const entries: Dirent[] = await readdir(managedVmSandboxRuntimePaths.gvisorBinDirectory, { withFileTypes: true });
  const observedNames: string[] = entries
    .map((entry: Dirent): string => entry.name)
    .sort((left: string, right: string): number => left.localeCompare(right));
  if (
    entries.some((entry: Dirent): boolean => !entry.isFile()) ||
    JSON.stringify(observedNames) !== JSON.stringify(managedVmSandboxRuntimeHelperNames)
  ) {
    throw new Error('Managed-VM reset found unexpected content in the gVisor helper directory.');
  }
}

function assertCurrentManagedVmRelease(state: ManagedVmProvisionerState): void {
  if (state.metadataDigest !== currentMetadataDigest()) {
    throw new Error(
      'This managed VM uses an older installer-owned runtime. Reset and reinstall it before updating Compartment.',
    );
  }
}

function assertOwnedRelease(state: ManagedVmProvisionerState): void {
  if (
    state.metadataDigest !== digest(JSON.stringify(state.releaseMetadata)) ||
    JSON.stringify(state.resolvedArtifacts) !== JSON.stringify(state.releaseMetadata.artifacts)
  ) {
    throw new Error('Managed-VM release ownership metadata is invalid; refusing lifecycle mutation.');
  }
}

function currentMetadataDigest(): string {
  return digest(JSON.stringify(managedVmReleaseMetadata));
}

async function requireManagedVmState(): Promise<ManagedVmProvisionerState> {
  const state: ManagedVmProvisionerState | undefined = await readManagedVmState();
  if (state === undefined) {
    throw new Error('This host is not a Compartment-managed VM installation.');
  }
  return state;
}
