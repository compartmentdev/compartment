import { resolve } from 'node:path';
import { writeVerifiedKubernetesInstallImageValues } from './kubernetes-image-trust.service';
import { resolveKubernetesChartPath } from './kubernetes-install-helm.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
} from './kubernetes-install.service.types';

export async function prepareKubernetesInstallHelmMaterial(
  input: KubernetesInstallDeploymentInput,
  materializedDirectory: string,
): Promise<KubernetesInstallHelmMaterial> {
  const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
  const imageTrustValuesPath: string = resolve(materializedDirectory, 'image-trust-values.json');
  await writeVerifiedKubernetesInstallImageValues({
    chartPath,
    operatorValuesPath: input.valuesPath,
    outputPath: imageTrustValuesPath,
  });
  return { chartPath, imageTrustValuesPath, installValuesPath: resolve(materializedDirectory, 'install-values.json') };
}
