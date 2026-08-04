import {
  cleanManagedVmArtifacts,
  downloadManagedVmArtifacts,
  type ManagedVmDownloadedArtifacts,
} from './managed-vm-artifacts.service';
import {
  configureManagedVmRegistryIssuer,
  installManagedVmCertManager,
  installManagedVmK3s,
  isManagedVmStageHealthy,
  prepareManagedVmHost,
  verifyManagedVmPrerequisites,
  waitForManagedVmKubernetes,
} from './managed-vm-cluster.service';
import { installManagedVmSandboxRuntime } from './managed-vm-sandbox-runtime.service';
import { installManagedVmFirewall } from './managed-vm-firewall.service';
import type { ManagedVmInstallStage, ManagedVmProvisionerState } from './managed-vm-provisioning.types';
import type { ManagedVmProvisionInput } from './managed-vm-provisioner.service.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import {
  assertManagedVmOwnedFileDigests,
  createManagedVmState,
  digest,
  managedVmOwnedPaths,
  persistManagedVmStage,
  readManagedVmState,
} from './managed-vm-state.service';
import { acquireManagedVmLock } from './managed-vm-lock.service';
import { isManagedVmInstallStageComplete } from './managed-vm-stage.service';
import { isSeaRuntime } from '../sea';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export async function provisionManagedVmCluster(input: ManagedVmProvisionInput): Promise<ManagedVmProvisionerState> {
  assertPrivileged();
  assertPackagedCli();
  const releaseLock: () => Promise<void> = await acquireManagedVmLock();
  let artifacts: ManagedVmDownloadedArtifacts | undefined;
  try {
    artifacts = await downloadManagedVmArtifacts(managedVmReleaseMetadata.artifacts);
    return await runProvisioningStages(input, artifacts);
  } finally {
    if (artifacts !== undefined) {
      await cleanManagedVmArtifacts(artifacts);
    }
    await releaseLock();
  }
}

function assertPackagedCli(): void {
  if (!isSeaRuntime()) {
    throw new Error('Managed-VM provisioning requires the verified packaged Compartment CLI.');
  }
}

async function runProvisioningStages(
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState | undefined = await readManagedVmState();
  const config: string = `${input.publicAddress}\n${input.publicInterface}\n`;
  if (state === undefined) {
    await assertNoPreexistingOwnedPaths();
    state = await createManagedVmState(config);
  }
  assertResumeIdentity(state, config);
  return await runClusterStages(state, input, artifacts);
}

async function runClusterStages(
  initialState: ManagedVmProvisionerState,
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState = initialState;
  state = await runStage(
    state,
    'preparing-host',
    input,
    async (): Promise<void> => await prepareHostStage(input, artifacts),
  );
  state = await runK3sStage(state, input, artifacts);
  state = await runStage(state, 'waiting-for-kubernetes', input, waitForManagedVmKubernetes);
  return await runPostKubernetesStages(state, input, artifacts);
}

async function runPostKubernetesStages(
  initialState: ManagedVmProvisionerState,
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState = initialState;
  state = await runStage(
    state,
    'installing-sandbox-runtime',
    input,
    async (): Promise<void> => await installManagedVmSandboxRuntime(artifacts),
  );
  state = await runStage(
    state,
    'installing-cert-manager',
    input,
    async (): Promise<void> => await installCertManagerStage(artifacts),
  );
  return await runStage(state, 'verifying-prerequisites', input, verifyManagedVmPrerequisites);
}

async function runK3sStage(
  state: ManagedVmProvisionerState,
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<ManagedVmProvisionerState> {
  return await runStage(
    state,
    'installing-k3s',
    input,
    async (): Promise<void> => await installManagedVmK3s(artifacts),
  );
}

async function prepareHostStage(
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<void> {
  await installManagedVmFirewall(input.publicInterface);
  await prepareManagedVmHost(artifacts, input.publicAddress);
}

async function installCertManagerStage(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await installManagedVmCertManager(artifacts.certManagerManifestPath);
  await configureManagedVmRegistryIssuer();
}

async function assertNoPreexistingOwnedPaths(): Promise<void> {
  const conflicts: string[] = [];
  for (const ownedPath of managedVmOwnedPaths) {
    try {
      await access(ownedPath.path, constants.F_OK);
      conflicts.push(ownedPath.path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Managed-VM provisioning refuses to overwrite existing host paths: ${conflicts.join(', ')}`);
  }
}

async function runStage(
  state: ManagedVmProvisionerState,
  stage: ManagedVmInstallStage,
  input: ManagedVmProvisionInput,
  action: () => Promise<void>,
): Promise<ManagedVmProvisionerState> {
  if (isManagedVmInstallStageComplete(state.completedStage, stage)) {
    await assertManagedVmOwnedFileDigests(state);
    if (await isManagedVmStageHealthy(stage)) {
      return state;
    }
  }
  input.reportStage(stage);
  await action();
  return await persistManagedVmStage(state, stage);
}

function assertResumeIdentity(state: ManagedVmProvisionerState, config: string): void {
  const metadataDigest: string = digest(JSON.stringify(managedVmReleaseMetadata));
  if (state.configDigest !== digest(config) || state.metadataDigest !== metadataDigest) {
    throw new Error(
      'Managed-VM state does not match the reviewed host configuration or release metadata. Diagnose before retrying.',
    );
  }
}

function assertPrivileged(): void {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('Managed-VM provisioning must run through the reviewed sudo re-exec.');
  }
}
