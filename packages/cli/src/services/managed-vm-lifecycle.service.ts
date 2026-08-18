import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { verifyManagedVmComponentVersions } from './managed-vm-cluster.service';
import type { ManagedVmSystemStatus } from './managed-vm-lifecycle.service.types';
import type { ManagedVmProvisionerState, ManagedVmUpdateState } from './managed-vm-provisioning.types';
import {
  assertManagedVmOwnedFileDigests,
  completeManagedVmReleaseUpdate,
  digest,
  managedVmOwnedPaths,
  managedVmOwnedPathsEqual,
  persistManagedVmUpdate,
  readManagedVmState,
} from './managed-vm-state.service';
import { acquireManagedVmLock } from './managed-vm-lock.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { isManagedVmUpdateStageComplete } from './managed-vm-stage.service';
import { verifyManagedVmSandboxRuntime } from './managed-vm-sandbox-runtime.service';
import {
  completeManagedVmBuildRuntimeMigration,
  prepareManagedVmBuildRuntimeMigration,
} from './managed-vm-build-runtime-migration.service';

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

async function prepareManagedVmUpdate(): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState = await requireManagedVmState();
  assertOwnedRelease(state);
  const requiresBuildRuntimeMigration: boolean = await prepareManagedVmBuildRuntimeMigration(state);
  await assertCurrentManagedVmStateUnlessMigrating(state, requiresBuildRuntimeMigration);
  state = await beginManagedVmUpdate(state);
  if (requiresBuildRuntimeMigration) {
    state = await completeManagedVmBuildRuntimeMigration(state);
  }
  return await finishManagedVmUpdatePreparation(state);
}

async function assertCurrentManagedVmStateUnlessMigrating(
  state: ManagedVmProvisionerState,
  migrationRequired: boolean,
): Promise<void> {
  if (migrationRequired) {
    return;
  }
  assertCurrentManagedVmRelease(state);
  assertOwnedManifest(state);
  await assertManagedVmOwnedFileDigests(state);
}

async function finishManagedVmUpdatePreparation(state: ManagedVmProvisionerState): Promise<ManagedVmProvisionerState> {
  const next: ManagedVmProvisionerState = await installManagedVmUpdateComponents(state);
  if (!isManagedVmUpdateStageComplete(requireManagedVmUpdate(next).stage, 'components-installed')) {
    throw new Error('Managed-VM update has not completed its verified component stage.');
  }
  await verifyManagedVmSandboxRuntime();
  return next;
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

function assertOwnedManifest(state: ManagedVmProvisionerState): void {
  if (!managedVmOwnedPathsEqual(state.ownedPaths, managedVmOwnedPaths)) {
    throw new Error('Managed-VM ownership manifest is invalid; refusing lifecycle mutation.');
  }
}

function assertCurrentManagedVmRelease(state: ManagedVmProvisionerState): void {
  if (state.metadataDigest !== currentMetadataDigest()) {
    throw new Error(
      'This managed VM uses an older installer-owned runtime. Reprovision the VM before updating Compartment.',
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
