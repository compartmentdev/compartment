import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { readExistingKubernetesInstallRelease } from './kubernetes-install-release.service';
import { readRetainedKubernetesInstallState } from './kubernetes-install-retained-state.service';
import type {
  ExistingKubernetesInstallRelease,
  KubernetesInstallDeploymentInput,
  KubernetesInstallInspection,
} from './kubernetes-install.service.types';

export async function inspectKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<KubernetesInstallInspection> {
  return await runObservableInstallStep(
    input.progress,
    'Inspecting existing installation',
    async (): Promise<KubernetesInstallInspection> => {
      const release: ExistingKubernetesInstallRelease | null = await readExistingKubernetesInstallRelease(input);
      return {
        existingInstall: release?.install ?? null,
        releaseValues: release?.values ?? null,
        retainedState: await readRetainedKubernetesInstallState(input),
      };
    },
  );
}
