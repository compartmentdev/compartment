import type { ManagedVmArtifact, ManagedVmCurrentReleaseMetadata } from './managed-vm-provisioning.types';
import { kubernetesInstallCompatibility } from './kubernetes-install-compatibility.service';
import type { ManagedKubernetesInstallCompatibility } from './kubernetes-install-compatibility.service.types';

const managedCompatibility: ManagedKubernetesInstallCompatibility = kubernetesInstallCompatibility.managed;

export const managedVmReleaseMetadata: ManagedVmCurrentReleaseMetadata = {
  artifacts: [
    managedCompatibility.k3s,
    managedCompatibility.k3sInstallScript,
    managedCompatibility.helm,
    managedCompatibility.certManager,
    requireManagedGvisorArtifact(),
  ],
  certManagerVersion: managedCompatibility.certManager.version,
  gvisorVersion: managedCompatibility.gvisor.version,
  helmVersion: managedCompatibility.helm.version,
  k3sChannel: managedCompatibility.k3sChannel,
  k3sVersion: managedCompatibility.k3s.version,
  kubernetesMinor: managedCompatibility.kubernetesMinor,
  metadataVersion: 5,
  podCidr: `${['10', '42', '0', '0'].join('.')}/16`,
  serviceCidr: `${['10', '43', '0', '0'].join('.')}/16`,
};

function requireManagedGvisorArtifact(): ManagedVmArtifact {
  const artifact: ManagedVmArtifact = managedCompatibility.gvisor;
  if (artifact.sha512 === undefined) {
    throw new Error('Managed gVisor metadata must include a SHA-512 digest.');
  }
  return { ...artifact, name: 'gvisor' as const, sha512: artifact.sha512 };
}
