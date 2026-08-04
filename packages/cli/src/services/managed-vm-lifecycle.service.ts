import { rm } from 'node:fs/promises';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import {
  configureManagedVmRegistryIssuer,
  installManagedVmCertManager,
  installManagedVmK3s,
  installManagedVmHelm,
  verifyManagedVmComponentVersions,
} from './managed-vm-cluster.service';
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
  managedVmOwnedPaths,
  persistManagedVmUpdate,
  recordManagedVmOwnedFileDigests,
  readManagedVmState,
} from './managed-vm-state.service';
import { acquireManagedVmLock } from './managed-vm-lock.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import {
  cleanManagedVmArtifacts,
  downloadManagedVmArtifacts,
  type ManagedVmDownloadedArtifacts,
} from './managed-vm-artifacts.service';
import { removeManagedVmOwnedPaths } from './managed-vm-owned-paths.service';
import { isManagedVmInstallStageComplete, isManagedVmUpdateStageComplete } from './managed-vm-stage.service';

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
  state = await beginManagedVmUpdate(state);
  state = await installManagedVmUpdateComponents(state);
  if (!isManagedVmUpdateStageComplete(requireManagedVmUpdate(state).stage, 'components-installed')) {
    throw new Error('Managed-VM update has not completed its verified component stage.');
  }
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
  if (state.metadataDigest === currentMetadataDigest()) {
    await verifyManagedVmComponentVersions();
    return await persistManagedVmUpdate(state, {
      ...update,
      stage: 'components-installed',
      updatedAt: new Date().toISOString(),
    });
  }
  return await reinstallManagedVmComponents(state, update);
}

async function reinstallManagedVmComponents(
  state: ManagedVmProvisionerState,
  update: ManagedVmUpdateState,
): Promise<ManagedVmProvisionerState> {
  const artifacts: ManagedVmDownloadedArtifacts = await downloadManagedVmArtifacts(managedVmReleaseMetadata.artifacts);
  try {
    await installManagedVmK3s(artifacts);
    await installManagedVmHelm(artifacts);
    await installManagedVmCertManager(artifacts.certManagerManifestPath);
    await configureManagedVmRegistryIssuer();
    await verifyManagedVmComponentVersions();
    state = await recordManagedVmOwnedFileDigests(state);
    return await persistManagedVmUpdate(state, {
      ...update,
      stage: 'components-installed',
      updatedAt: new Date().toISOString(),
    });
  } finally {
    await cleanManagedVmArtifacts(artifacts);
  }
}

function requireManagedVmUpdate(state: ManagedVmProvisionerState): ManagedVmUpdateState {
  if (state.update === undefined) {
    throw new Error('Managed-VM update state is missing.');
  }
  return state.update;
}

async function removeOwnedManagedVmPaths(state: ManagedVmProvisionerState): Promise<void> {
  const completedPaths: readonly string[] = state.ownedPaths
    .filter((ownedPath: ManagedVmOwnedPath): boolean =>
      isManagedVmInstallStageComplete(state.completedStage, ownedPath.stage),
    )
    .map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path);
  await removeManagedVmOwnedPaths(completedPaths);
}

function assertOwnedManifest(state: ManagedVmProvisionerState): void {
  const expected: string = JSON.stringify(managedVmOwnedPaths);
  if (JSON.stringify(state.ownedPaths) !== expected) {
    throw new Error('Managed-VM ownership manifest is invalid; refusing lifecycle mutation.');
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
