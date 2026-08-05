import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';

export interface ManagedVmArtifactsTestModule {
  cleanManagedVmArtifacts(): Promise<void>;
  downloadManagedVmArtifacts(): Promise<ManagedVmDownloadedArtifacts>;
}

export interface ManagedVmLockTestModule {
  acquireManagedVmLock(): Promise<() => Promise<void>>;
}

export interface ManagedVmSeaTestModule {
  isSeaRuntime(): boolean;
}
