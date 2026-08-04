export type ManagedVmInstallStage =
  | 'pending'
  | 'preparing-host'
  | 'installing-k3s'
  | 'waiting-for-kubernetes'
  | 'installing-cert-manager'
  | 'verifying-prerequisites'
  | 'installing-compartment'
  | 'configuring-domain'
  | 'creating-owner'
  | 'complete';

export type ManagedVmStateClassification = 'foreign' | 'fresh' | 'inconsistent' | 'locked' | 'resume';

export type ManagedVmArtifactName = 'cert-manager' | 'helm' | 'k3s' | 'k3s-install-script';

export interface ManagedVmArtifact {
  name: ManagedVmArtifactName;
  sha256: string;
  url: string;
  version: string;
}

export interface ManagedVmReleaseMetadata {
  artifacts: readonly ManagedVmArtifact[];
  certManagerVersion: string;
  helmVersion: string;
  k3sChannel: string;
  k3sVersion: string;
  kubernetesMinor: string;
  metadataVersion: number;
  podCidr: string;
  serviceCidr: string;
}

export interface ManagedVmHostInventory {
  architecture: string;
  cgroupV2: boolean;
  clockSynchronized: boolean;
  cpuCount: number;
  freeBytes: number;
  freeInodes: number;
  firewall: ManagedVmFirewallKind;
  hostname: string;
  localIpv4Addresses: readonly string[];
  memoryBytes: number;
  osId: string;
  osVersion: string;
  portsInUse: readonly ManagedVmPortConflict[];
  publicInterface: string;
  routeCidrs: readonly string[];
  requiredKernelModules: boolean;
  reachableEndpoints: readonly string[];
  systemd: boolean;
  sudoAvailable: boolean;
}

export type ManagedVmFirewallKind = 'firewalld' | 'nftables' | 'none' | 'ufw';

export interface ManagedVmDiskAvailability {
  freeBytes: number;
  freeInodes: number;
}

export interface ManagedVmHostObservation {
  clockSynchronized: boolean;
  disk: ManagedVmDiskAvailability;
  firewall: ManagedVmFirewallKind;
  localIpv4Addresses: readonly string[];
  modules: boolean;
  osRelease: string;
  portsInUse: readonly ManagedVmPortConflict[];
  publicInterface: string;
  reachableEndpoints: readonly string[];
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

export interface ManagedVmPreflightCheck {
  detail: string;
  name: string;
  passed: boolean;
}

export interface ManagedVmPreflightResult {
  checks: readonly ManagedVmPreflightCheck[];
  classification: ManagedVmStateClassification;
  inventory: ManagedVmHostInventory;
  metadata: ManagedVmReleaseMetadata;
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
