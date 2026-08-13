export type ManagedVmInstallStage =
  | 'pending'
  | 'preparing-host'
  | 'installing-k3s'
  | 'waiting-for-kubernetes'
  | 'installing-sandbox-runtime'
  | 'installing-cert-manager'
  | 'verifying-prerequisites'
  | 'installing-compartment'
  | 'configuring-domain'
  | 'creating-owner'
  | 'complete';

export type ManagedVmStateClassification = 'foreign' | 'fresh' | 'inconsistent' | 'locked' | 'resume';

export type ManagedVmArtifactName = 'cert-manager' | 'gvisor' | 'helm' | 'k3s' | 'k3s-install-script';

export interface ManagedVmArtifact {
  name: ManagedVmArtifactName;
  sha256: string;
  sha512?: string | undefined;
  url: string;
  version: string;
}

interface ManagedVmReleaseMetadataBase {
  artifacts: readonly ManagedVmArtifact[];
  certManagerVersion: string;
  helmVersion: string;
  k3sChannel: string;
  k3sVersion: string;
  kubernetesMinor: string;
  podCidr: string;
  serviceCidr: string;
}

export interface ManagedVmLegacyReleaseMetadata extends ManagedVmReleaseMetadataBase {
  metadataVersion: 1;
}

export interface ManagedVmPreviousReleaseMetadata extends ManagedVmReleaseMetadataBase {
  gvisorVersion: string;
  metadataVersion: 2;
}

export interface ManagedVmNodeIdentityReleaseMetadata extends ManagedVmReleaseMetadataBase {
  gvisorVersion: string;
  metadataVersion: 3;
}

export interface ManagedVmCurrentReleaseMetadata extends ManagedVmReleaseMetadataBase {
  gvisorVersion: string;
  metadataVersion: 4;
}

export type ManagedVmReleaseMetadata =
  | ManagedVmCurrentReleaseMetadata
  | ManagedVmNodeIdentityReleaseMetadata
  | ManagedVmLegacyReleaseMetadata
  | ManagedVmPreviousReleaseMetadata;

export interface ManagedVmHostInventory {
  archiveExtractorAvailable: boolean;
  architecture: string;
  cgroupV2: boolean;
  clockSynchronized: boolean;
  cpuCount: number;
  freeBytes: number;
  freeInodes: number;
  firewall: ManagedVmFirewallKind;
  hostname: string;
  memoryBytes: number;
  osId: string;
  osVersion: string;
  portsInUse: readonly ManagedVmPortConflict[];
  publicInterface: string;
  routeCidrs: readonly string[];
  systemd: boolean;
  sudoAvailable: boolean;
}

export type ManagedVmFirewallKind = 'firewalld' | 'nftables' | 'none' | 'ufw';

export interface ManagedVmDiskAvailability {
  freeBytes: number;
  freeInodes: number;
}

export interface ManagedVmHostObservation {
  archiveExtractorAvailable: boolean;
  clockSynchronized: boolean;
  disk: ManagedVmDiskAvailability;
  firewall: ManagedVmFirewallKind;
  osRelease: string;
  portsInUse: readonly ManagedVmPortConflict[];
  publicInterface: string;
  routeCidrs: readonly string[];
}

export interface ManagedVmPortConflict {
  owner: string;
  port: number;
}

export interface ManagedVmObservedState {
  foreignPaths: readonly string[];
  lockOwner?: string | undefined;
  ownedConfigMatches: boolean;
  provisionerStateExists: boolean;
}

type ManagedVmFailedPreflightCheckStatus = 'failed';
type ManagedVmSuccessfulPreflightCheckStatus = 'passed' | 'warning';

export interface ManagedVmFailedPreflightCheck {
  detail: string;
  name: string;
  passed: false;
  status: ManagedVmFailedPreflightCheckStatus;
}

export interface ManagedVmSuccessfulPreflightCheck {
  detail: string;
  name: string;
  passed: true;
  status: ManagedVmSuccessfulPreflightCheckStatus;
}

export type ManagedVmPreflightCheck = ManagedVmFailedPreflightCheck | ManagedVmSuccessfulPreflightCheck;
export type ManagedVmPreflightCheckStatus =
  | ManagedVmFailedPreflightCheckStatus
  | ManagedVmSuccessfulPreflightCheckStatus;

export interface ManagedVmPreflightResult {
  checks: readonly ManagedVmPreflightCheck[];
  classification: ManagedVmStateClassification;
  inventory: ManagedVmHostInventory;
  metadata: ManagedVmCurrentReleaseMetadata;
  publicAddress: string;
}

export interface ManagedVmProvisionerState {
  completedStage: ManagedVmInstallStage;
  configDigest: string;
  installationId: string;
  metadataDigest: string;
  ownedFileDigests: Readonly<Record<string, string>>;
  ownedPaths: readonly ManagedVmOwnedPath[];
  releaseMetadata: ManagedVmReleaseMetadata;
  resolvedArtifacts: readonly ManagedVmArtifact[];
  startedAt: string;
  update?: ManagedVmUpdateState | undefined;
  updatedAt: string;
}

export interface ManagedVmOwnedPath {
  path: string;
  stage: ManagedVmInstallStage;
}

export type ManagedVmUpdateStage =
  | 'preflight'
  | 'snapshot-created'
  | 'components-installed'
  | 'platform-updated'
  | 'verified';

export interface ManagedVmUpdateState {
  metadataDigest: string;
  snapshotName?: string | undefined;
  stage: ManagedVmUpdateStage;
  startedAt: string;
  updatedAt: string;
}
