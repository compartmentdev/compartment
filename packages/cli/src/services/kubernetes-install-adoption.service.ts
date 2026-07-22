import { rm } from 'node:fs/promises';
import {
  createKubernetesInstallMaterializedDirectory,
  runKubernetesHelmInstallStage,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { buildResolvedInstallValues } from './kubernetes-install-state.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
  KubernetesInstallState,
} from './kubernetes-install.service.types';

export async function materializeAdoptedKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  installToken: string,
  state: KubernetesInstallState,
): Promise<void> {
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    const material: KubernetesInstallHelmMaterial = await runObservableInstallStep(
      input.progress,
      'Preparing Helm chart and verifying images',
      async (): Promise<KubernetesInstallHelmMaterial> =>
        await prepareKubernetesInstallHelmMaterial(input, materializedDirectory),
    );
    await writeKubernetesInstallValues(material.installValuesPath, buildResolvedInstallValues(state, installToken));
    await deployAdoptedInstall(input, material);
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
}

async function deployAdoptedInstall(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
): Promise<void> {
  await runObservableInstallStep(
    input.progress,
    'Waiting for platform pods (api, worker, caddy)',
    async (): Promise<void> =>
      await runKubernetesHelmInstallStage(
        input,
        material.chartPath,
        material.platformImageValuesPath,
        material.installValuesPath,
        material.imageTrustValuesPath,
        'full',
      ),
  );
}
