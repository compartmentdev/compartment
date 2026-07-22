import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { readExistingKubernetesInstall } from './kubernetes-install-release.service';
import { readRetainedKubernetesInstallState } from './kubernetes-install-retained-state.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallInspection } from './kubernetes-install.service.types';

export async function inspectKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<KubernetesInstallInspection> {
  return await runObservableInstallStep(
    input.progress,
    'Inspecting existing installation',
    async (): Promise<KubernetesInstallInspection> => ({
      existingInstall: await readExistingKubernetesInstall(input),
      retainedState: await readRetainedKubernetesInstallState(input),
    }),
  );
}
