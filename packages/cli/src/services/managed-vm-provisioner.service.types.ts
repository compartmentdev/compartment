import type { ManagedVmInstallStage } from './managed-vm-provisioning.types';

export interface ManagedVmProvisionInput {
  publicAddress: string;
  publicInterface: string;
  reportStage: (stage: ManagedVmInstallStage) => void;
}
