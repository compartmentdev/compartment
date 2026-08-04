import type { ManagedVmReleaseMetadata } from './managed-vm-provisioning.types';
import { kubernetesInstallCompatibility } from './kubernetes-install-compatibility.service';
import type { ManagedKubernetesInstallCompatibility } from './kubernetes-install-compatibility.service.types';

const managedCompatibility: ManagedKubernetesInstallCompatibility = kubernetesInstallCompatibility.managed;

export const managedVmReleaseMetadata: ManagedVmReleaseMetadata = {
  artifacts: [
    managedCompatibility.k3s,
    managedCompatibility.k3sInstallScript,
    managedCompatibility.helm,
    managedCompatibility.certManager,
    managedCompatibility.gvisor,
  ],
  certManagerVersion: managedCompatibility.certManager.version,
  gvisorVersion: managedCompatibility.gvisor.version,
  helmVersion: managedCompatibility.helm.version,
  k3sChannel: managedCompatibility.k3sChannel,
  k3sVersion: managedCompatibility.k3s.version,
  kubernetesMinor: managedCompatibility.kubernetesMinor,
  metadataVersion: 2,
  podCidr: `${['10', '42', '0', '0'].join('.')}/16`,
  serviceCidr: `${['10', '43', '0', '0'].join('.')}/16`,
};
