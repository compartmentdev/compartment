import type {
  ManagedVmBuildRuntimePreviousReleaseMetadata,
  ManagedVmOwnedPath,
  ManagedVmProvisionerState,
  ManagedVmReleaseMigrationInput,
} from './managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { managedVmSandboxRuntimePaths } from './managed-vm-sandbox-runtime.constants';
import { upgradeManagedVmBuildSandboxRuntime } from './managed-vm-build-runtime-upgrade.service';
import {
  assertManagedVmOwnedFileDigests,
  digest,
  managedVmOwnedPaths,
  managedVmOwnedPathsEqual,
  writeManagedVmStateAtomically,
} from './managed-vm-state.service';

const previousReleaseMetadata: ManagedVmBuildRuntimePreviousReleaseMetadata = {
  ...managedVmReleaseMetadata,
  metadataVersion: 5,
};
const previousOwnedPaths: readonly ManagedVmOwnedPath[] = managedVmOwnedPaths.filter(
  (ownedPath: ManagedVmOwnedPath): boolean => ownedPath.path !== managedVmSandboxRuntimePaths.buildRunscConfig,
);

export async function prepareManagedVmBuildRuntimeMigration(state: ManagedVmProvisionerState): Promise<boolean> {
  if (!isPreviousRelease(state)) {
    return false;
  }
  if (!managedVmOwnedPathsEqual(state.ownedPaths, previousOwnedPaths)) {
    throw new Error('Managed-VM ownership manifest is invalid; refusing lifecycle mutation.');
  }
  await assertUnchangedFilesOutsideMigratedTemplate(state);
  return true;
}

export async function completeManagedVmBuildRuntimeMigration(
  state: ManagedVmProvisionerState,
): Promise<ManagedVmProvisionerState> {
  const ownedFileDigests: Readonly<Record<string, string>> = await upgradeManagedVmBuildSandboxRuntime();
  return await persistReleaseMigration(state, {
    ownedFileDigests,
    ownedPaths: managedVmOwnedPaths,
    releaseMetadata: managedVmReleaseMetadata,
  });
}

function isPreviousRelease(state: ManagedVmProvisionerState): boolean {
  return (
    state.metadataDigest === digest(JSON.stringify(previousReleaseMetadata)) &&
    JSON.stringify(state.releaseMetadata) === JSON.stringify(previousReleaseMetadata) &&
    JSON.stringify(state.resolvedArtifacts) === JSON.stringify(previousReleaseMetadata.artifacts)
  );
}

async function assertUnchangedFilesOutsideMigratedTemplate(state: ManagedVmProvisionerState): Promise<void> {
  const templatePath: string = managedVmSandboxRuntimePaths.containerdTemplate;
  const ownedPaths: readonly ManagedVmOwnedPath[] = state.ownedPaths.filter(
    (ownedPath: ManagedVmOwnedPath): boolean => ownedPath.path !== templatePath,
  );
  const ownedFileDigests: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(state.ownedFileDigests).filter(([path]: [string, string]): boolean => path !== templatePath),
  );
  await assertManagedVmOwnedFileDigests({ ...state, ownedFileDigests, ownedPaths });
}

async function persistReleaseMigration(
  state: ManagedVmProvisionerState,
  input: ManagedVmReleaseMigrationInput,
): Promise<ManagedVmProvisionerState> {
  const next: ManagedVmProvisionerState = {
    ...state,
    metadataDigest: digest(JSON.stringify(input.releaseMetadata)),
    ownedFileDigests: { ...state.ownedFileDigests, ...input.ownedFileDigests },
    ownedPaths: input.ownedPaths,
    releaseMetadata: input.releaseMetadata,
    resolvedArtifacts: input.releaseMetadata.artifacts,
    updatedAt: new Date().toISOString(),
  };
  await writeManagedVmStateAtomically(next);
  return next;
}
