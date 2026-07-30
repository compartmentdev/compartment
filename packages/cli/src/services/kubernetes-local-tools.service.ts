import { AsyncLocalStorage } from 'node:async_hooks';
import { assertKubernetesInstallLocalTools } from './kubernetes-install-local-tools.service';

const verifiedKubernetesTools: AsyncLocalStorage<boolean> = new AsyncLocalStorage<boolean>();

export async function withKubernetesLocalTools<Result>(action: () => Promise<Result>): Promise<Result> {
  if (verifiedKubernetesTools.getStore() === true) {
    return await action();
  }
  await assertKubernetesInstallLocalTools();
  return await verifiedKubernetesTools.run(true, action);
}
