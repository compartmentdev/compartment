import { AsyncLocalStorage } from 'node:async_hooks';
import { assertKubernetesInstallLocalTools } from './kubernetes-install-local-tools.service';
import type { KubernetesInstallLocalToolVersions } from './kubernetes-install-local-tools.service.types';

const verifiedKubernetesTools: AsyncLocalStorage<KubernetesInstallLocalToolVersions> =
  new AsyncLocalStorage<KubernetesInstallLocalToolVersions>();

export async function withKubernetesLocalTools<Result>(
  action: (versions: KubernetesInstallLocalToolVersions) => Promise<Result>,
): Promise<Result> {
  const verified: KubernetesInstallLocalToolVersions | undefined = verifiedKubernetesTools.getStore();
  if (verified !== undefined) {
    return await action(verified);
  }
  const versions: KubernetesInstallLocalToolVersions = await assertKubernetesInstallLocalTools();
  return await verifiedKubernetesTools.run(versions, action, versions);
}
