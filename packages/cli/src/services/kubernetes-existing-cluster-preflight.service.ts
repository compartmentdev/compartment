import { assertCertManager } from './kubernetes-existing-cluster-preflight.cert-manager';
import {
  assertClusterVersion,
  assertPermissions,
  assertReleaseOwnership,
  assertRequiredApiResources,
} from './kubernetes-existing-cluster-preflight.cluster';
import {
  assertIngressClass,
  assertIngressHostsAvailable,
  assertRetainedIdentity,
  assertStorageClass,
} from './kubernetes-existing-cluster-preflight.resources';
import type {
  KubernetesExistingClusterPreflightInput,
  KubernetesExistingClusterPreflightResult,
} from './kubernetes-existing-cluster-preflight.service.types';
import { assertKubernetesInstallAcmeEmail } from './kubernetes-install-email.service';
import { assertKubernetesImageVolumeCapability } from './kubernetes-image-volume-preflight.service';

export async function runKubernetesExistingClusterPreflight(
  input: KubernetesExistingClusterPreflightInput,
): Promise<KubernetesExistingClusterPreflightResult> {
  assertKubernetesInstallAcmeEmail(input.install.owner.email);
  const kubernetesVersion: string = await assertClusterVersion(input.install);
  await assertRequiredApiResources(input.install);
  await assertKubernetesImageVolumeCapability(input.install);
  await assertPermissions(input.install);
  await assertReleaseOwnership(input.install, input.chartFullname);
  await assertIngressClass(input.install);
  await assertCertManager(input.install);
  await assertStorageClass(input.install);
  await assertIngressHostsAvailable(input.install, input.apiHosts);
  await assertRetainedIdentity(input.install);
  return { kubernetesVersion };
}
