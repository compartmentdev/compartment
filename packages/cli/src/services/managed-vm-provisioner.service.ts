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
import type {
  ManagedVmInstallStage,
  ManagedVmOwnedPath,
  ManagedVmProvisionerState,
} from './managed-vm-provisioning.types';
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
import { findExistingManagedVmPaths, managedVmK3sGeneratedConflictPaths } from './managed-vm-install-paths.service';
import { acquireManagedVmLock } from './managed-vm-lock.service';
import { isManagedVmInstallStageComplete } from './managed-vm-stage.service';
import { loadManagedVmKernelModules } from './managed-vm-kernel-modules.service';
import { isSeaRuntime } from '../sea';

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
  let state: ManagedVmProvisionerState = await runStage(
    initialState,
    'preparing-host',
    input,
    async (): Promise<Readonly<Record<string, string>>> => await prepareHostStage(input, artifacts),
  );
  state = await runStage(
    state,
    'installing-k3s',
    input,
    async (): Promise<Readonly<Record<string, string>>> => await installManagedVmK3s(artifacts),
  );
  state = await runStage(
    state,
    'waiting-for-kubernetes',
    input,
    async (): Promise<Readonly<Record<string, string>>> => await runNoHostStage(waitForManagedVmKubernetes),
  );
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
    async (): Promise<Readonly<Record<string, string>>> => await installManagedVmSandboxRuntime(artifacts),
  );
  return await runPostSandboxStages(state, input, artifacts);
}

async function runPostSandboxStages(
  initialState: ManagedVmProvisionerState,
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<ManagedVmProvisionerState> {
  let state: ManagedVmProvisionerState = initialState;
  state = await runStage(
    state,
    'installing-cert-manager',
    input,
    async (): Promise<Readonly<Record<string, string>>> =>
      await runNoHostStage(async (): Promise<void> => await installCertManagerStage(artifacts)),
  );
  return await runStage(
    state,
    'verifying-prerequisites',
    input,
    async (): Promise<Readonly<Record<string, string>>> => await runNoHostStage(verifyManagedVmPrerequisites),
  );
}

async function prepareHostStage(
  input: ManagedVmProvisionInput,
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<Readonly<Record<string, string>>> {
  await loadManagedVmKernelModules();
  const hostIdentities: Readonly<Record<string, string>> = await prepareManagedVmHost(artifacts, input.publicAddress);
  const firewallIdentities: Readonly<Record<string, string>> = await installManagedVmFirewall(input.publicInterface);
  return { ...hostIdentities, ...firewallIdentities };
}

async function installCertManagerStage(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await installManagedVmCertManager(artifacts.certManagerManifestPath);
  await configureManagedVmRegistryIssuer();
}

async function runNoHostStage(action: () => Promise<void>): Promise<Readonly<Record<string, string>>> {
  await action();
  return {};
}

async function assertNoPreexistingOwnedPaths(): Promise<void> {
  const conflictPaths: readonly string[] = [
    ...managedVmOwnedPaths.map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path),
    ...managedVmK3sGeneratedConflictPaths,
  ];
  const conflicts: string[] = await findExistingManagedVmPaths(conflictPaths);
  if (conflicts.length > 0) {
    throw new Error(`Managed-VM provisioning refuses to overwrite existing host paths: ${conflicts.join(', ')}`);
  }
}

async function runStage(
  state: ManagedVmProvisionerState,
  stage: ManagedVmInstallStage,
  input: ManagedVmProvisionInput,
  action: () => Promise<Readonly<Record<string, string>>>,
): Promise<ManagedVmProvisionerState> {
  await assertManagedVmOwnedFileDigests(state);
  if (isManagedVmInstallStageComplete(state.completedStage, stage)) {
    return await repairCompletedStage(state, stage, input, action);
  }
  await assertStageMutationPathsAreAbsent(state, stage);
  input.reportStage(stage);
  const expectedOwnedFileDigests: Readonly<Record<string, string>> = await action();
  return await persistManagedVmStage(state, stage, expectedOwnedFileDigests);
}

async function repairCompletedStage(
  state: ManagedVmProvisionerState,
  stage: ManagedVmInstallStage,
  input: ManagedVmProvisionInput,
  action: () => Promise<Readonly<Record<string, string>>>,
): Promise<ManagedVmProvisionerState> {
  if (await isManagedVmStageHealthy(stage)) {
    return state;
  }
  if (isManagedVmHostMutationStage(stage)) {
    throw new Error(
      `Managed-VM stage ${stage} is recorded but unhealthy; refusing automatic repair. Diagnose or reprovision the VM.`,
    );
  }
  input.reportStage(stage);
  await action();
  return state;
}

async function assertStageMutationPathsAreAbsent(
  state: ManagedVmProvisionerState,
  stage: ManagedVmInstallStage,
): Promise<void> {
  if (!isManagedVmHostMutationStage(stage)) {
    return;
  }
  const ownedPaths: string[] = state.ownedPaths
    .filter((ownedPath: ManagedVmOwnedPath): boolean => ownedPath.stage === stage)
    .map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path);
  const paths: readonly string[] =
    stage === 'installing-k3s' ? [...ownedPaths, ...managedVmK3sGeneratedConflictPaths] : ownedPaths;
  const conflicts: string[] = await findExistingManagedVmPaths(paths);
  if (conflicts.length > 0) {
    throw new Error(
      `Managed-VM stage ${stage} has partial or foreign host paths and cannot resume safely: ${conflicts.join(', ')}. Reprovision the VM.`,
    );
  }
}

function isManagedVmHostMutationStage(stage: ManagedVmInstallStage): boolean {
  return stage === 'preparing-host' || stage === 'installing-k3s' || stage === 'installing-sandbox-runtime';
}

function assertResumeIdentity(state: ManagedVmProvisionerState, config: string): void {
  if (state.releaseMetadata.metadataVersion !== managedVmReleaseMetadata.metadataVersion) {
    throw new Error(
      `Managed-VM state metadata version ${String(state.releaseMetadata.metadataVersion)} cannot resume with installer metadata version ${String(managedVmReleaseMetadata.metadataVersion)}. Reprovision the VM.`,
    );
  }
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
