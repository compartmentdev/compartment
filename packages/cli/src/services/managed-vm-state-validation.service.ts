import type {
  ManagedVmArtifact,
  ManagedVmCurrentReleaseMetadata,
  ManagedVmOwnedPath,
  ManagedVmProvisionerState,
  ManagedVmReleaseMetadata,
  ManagedVmUpdateState,
} from './managed-vm-provisioning.types';
import { isManagedVmInstallStage, isManagedVmUpdateStage } from './managed-vm-stage.service';

const statePath: string = '/var/lib/compartment/installer/state.json';
const artifactNames: readonly string[] = ['cert-manager', 'gvisor', 'helm', 'k3s', 'k3s-install-script'];

type ManagedVmArtifactBoundary = Partial<ManagedVmArtifact>;

type ManagedVmOwnedPathBoundary = Partial<ManagedVmOwnedPath>;

interface ManagedVmReleaseMetadataBoundary extends Partial<
  Omit<ManagedVmCurrentReleaseMetadata, 'artifacts' | 'metadataVersion'>
> {
  artifacts?: readonly ManagedVmArtifactBoundary[] | null | undefined;
  metadataVersion?: number | undefined;
}

type ManagedVmUpdateBoundary = Partial<ManagedVmUpdateState>;

interface ManagedVmStateBoundary extends Omit<
  Partial<ManagedVmProvisionerState>,
  'ownedFileDigests' | 'ownedPaths' | 'releaseMetadata' | 'resolvedArtifacts' | 'update'
> {
  ownedFileDigests?: Readonly<Record<string, string | number | null>> | readonly string[] | null | undefined;
  ownedPaths?: readonly (ManagedVmOwnedPathBoundary | null)[] | null | undefined;
  releaseMetadata?: ManagedVmReleaseMetadataBoundary | null | undefined;
  resolvedArtifacts?: readonly (ManagedVmArtifactBoundary | null)[] | null | undefined;
  update?: ManagedVmUpdateBoundary | null | undefined;
}

export function parseManagedVmState(content: string): ManagedVmProvisionerState {
  const candidate: ManagedVmStateBoundary | null = JSON.parse(content) as ManagedVmStateBoundary | null;
  if (candidate === null || !isValidManagedVmState(candidate)) {
    throw new Error(`Managed-VM state at ${statePath} is invalid.`);
  }
  return candidate as ManagedVmProvisionerState;
}

function isValidManagedVmState(candidate: ManagedVmStateBoundary): boolean {
  return (
    typeof candidate.installationId === 'string' &&
    typeof candidate.completedStage === 'string' &&
    isManagedVmInstallStage(candidate.completedStage) &&
    typeof candidate.configDigest === 'string' &&
    typeof candidate.metadataDigest === 'string' &&
    isOwnedFileDigestRecord(candidate.ownedFileDigests) &&
    isManagedVmArtifacts(candidate.resolvedArtifacts) &&
    isManagedVmOwnedPaths(candidate.ownedPaths) &&
    isManagedVmReleaseMetadata(candidate.releaseMetadata) &&
    isManagedVmUpdate(candidate.update) &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isOwnedFileDigestRecord(
  value: Readonly<Record<string, string | number | null>> | readonly string[] | null | undefined,
): value is Readonly<Record<string, string>> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((digest: string | number | null): boolean => typeof digest === 'string')
  );
}

function isManagedVmReleaseMetadata(
  value: ManagedVmReleaseMetadataBoundary | null | undefined,
): value is ManagedVmReleaseMetadata {
  if (value === null || value === undefined) {
    return false;
  }
  const commonFieldsAreValid: boolean =
    isManagedVmArtifacts(value.artifacts) &&
    typeof value.certManagerVersion === 'string' &&
    typeof value.helmVersion === 'string' &&
    typeof value.k3sChannel === 'string' &&
    typeof value.k3sVersion === 'string' &&
    typeof value.kubernetesMinor === 'string' &&
    typeof value.podCidr === 'string' &&
    typeof value.serviceCidr === 'string';
  return (
    commonFieldsAreValid &&
    (value.metadataVersion === 1 || (value.metadataVersion === 2 && typeof value.gvisorVersion === 'string'))
  );
}

function isManagedVmArtifacts(
  value: readonly (ManagedVmArtifactBoundary | null)[] | null | undefined,
): value is readonly ManagedVmArtifact[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: ManagedVmArtifactBoundary | null): boolean =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.name === 'string' &&
        artifactNames.includes(item.name) &&
        typeof item.sha256 === 'string' &&
        typeof item.url === 'string' &&
        typeof item.version === 'string',
    )
  );
}

function isManagedVmOwnedPaths(
  value: readonly (ManagedVmOwnedPathBoundary | null)[] | null | undefined,
): value is readonly ManagedVmOwnedPath[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: ManagedVmOwnedPathBoundary | null): boolean =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.path === 'string' &&
        typeof item.stage === 'string' &&
        isManagedVmInstallStage(item.stage),
    )
  );
}

function isManagedVmUpdate(
  value: ManagedVmUpdateBoundary | null | undefined,
): value is ManagedVmUpdateState | undefined {
  return (
    value === undefined ||
    (value !== null &&
      typeof value.metadataDigest === 'string' &&
      typeof value.stage === 'string' &&
      isManagedVmUpdateStage(value.stage) &&
      typeof value.startedAt === 'string' &&
      typeof value.updatedAt === 'string' &&
      (value.snapshotName === undefined || typeof value.snapshotName === 'string'))
  );
}
