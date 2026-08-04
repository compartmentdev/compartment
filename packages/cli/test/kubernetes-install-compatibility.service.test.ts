import { describe, expect, it } from 'vitest';
import {
  isKubectlVersionCompatibleWithServer,
  isSemanticVersionAtLeast,
  isSupportedKubernetesVersion,
  kubernetesInstallCompatibility,
} from '../src/services/kubernetes-install-compatibility.service';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';
import type { KubernetesInstallCompatibility } from '../src/services/kubernetes-install-compatibility.service.types';

describe('Kubernetes install compatibility', (): void => {
  it('accepts Kubernetes from the minimum onward without an upper minor ceiling', (): void => {
    expect(isSupportedKubernetesVersion('v1.29.9')).toBe(false);
    expect(isSupportedKubernetesVersion('v1.30.0')).toBe(true);
    expect(isSupportedKubernetesVersion('v1.30.0-eks.1')).toBe(true);
    expect(isSupportedKubernetesVersion('v1.40.0')).toBe(true);
  });

  it('requires kubectl within one minor of the API server', (): void => {
    expect(isKubectlVersionCompatibleWithServer('v1.34.0', 'v1.35.5')).toBe(true);
    expect(isKubectlVersionCompatibleWithServer('v1.35.0', 'v1.35.5')).toBe(true);
    expect(isKubectlVersionCompatibleWithServer('v1.36.0', 'v1.35.5')).toBe(true);
    expect(isKubectlVersionCompatibleWithServer('v1.33.0', 'v1.35.5')).toBe(false);
    expect(isKubectlVersionCompatibleWithServer('v1.37.0', 'v1.35.5')).toBe(false);
  });

  it('compares numeric prerelease identifiers numerically', (): void => {
    expect(isSemanticVersionAtLeast('v1.30.0-beta.11', 'v1.30.0-beta.2')).toBe(true);
    expect(isSemanticVersionAtLeast('v1.30.0-beta.2', 'v1.30.0-beta.11')).toBe(false);
  });

  it('keeps managed release pins inside the shared compatibility contract', (): void => {
    const compatibility: KubernetesInstallCompatibility = kubernetesInstallCompatibility;
    expect(isSupportedKubernetesVersion(compatibility.managed.k3s.version)).toBe(true);
    expect(isSemanticVersionAtLeast(compatibility.managed.helm.version, compatibility.helmMinimumVersion)).toBe(true);
    expect(managedVmReleaseMetadata).toMatchObject({
      artifacts: [
        compatibility.managed.k3s,
        compatibility.managed.k3sInstallScript,
        compatibility.managed.helm,
        compatibility.managed.certManager,
      ],
      certManagerVersion: compatibility.managed.certManager.version,
      helmVersion: compatibility.managed.helm.version,
      k3sChannel: compatibility.managed.k3sChannel,
      k3sVersion: compatibility.managed.k3s.version,
      kubernetesMinor: compatibility.managed.kubernetesMinor,
    });
  });
});
