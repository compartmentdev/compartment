import type { ManagedVmInstallStage, ManagedVmUpdateStage } from './managed-vm-provisioning.types';

const managedVmInstallStages: readonly ManagedVmInstallStage[] = [
  'pending',
  'preparing-host',
  'installing-k3s',
  'waiting-for-kubernetes',
  'installing-cert-manager',
  'verifying-prerequisites',
  'installing-compartment',
  'configuring-domain',
  'creating-owner',
  'complete',
];

const managedVmUpdateStages: readonly ManagedVmUpdateStage[] = [
  'preflight',
  'snapshot-created',
  'components-installed',
  'platform-updated',
  'verified',
];

export function isManagedVmInstallStageComplete(
  completed: ManagedVmInstallStage,
  candidate: ManagedVmInstallStage,
): boolean {
  return managedVmInstallStages.indexOf(completed) >= managedVmInstallStages.indexOf(candidate);
}

export function isManagedVmUpdateStageComplete(
  completed: ManagedVmUpdateStage,
  candidate: ManagedVmUpdateStage,
): boolean {
  return managedVmUpdateStages.indexOf(completed) >= managedVmUpdateStages.indexOf(candidate);
}
