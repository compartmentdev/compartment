import { resolve } from 'node:path';
import { writeVerifiedKubernetesInstallImageValues } from './kubernetes-image-trust.service';
import { resolveKubernetesChartPath, writeKubernetesInstallValues } from './kubernetes-install-helm.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
} from './kubernetes-install.service.types';
import {
  buildKubernetesPlatformImageVersionValues,
  resolvePackagedKubernetesPlatformVersion,
} from './kubernetes-platform-version.service';

export async function prepareKubernetesInstallHelmMaterial(
  input: KubernetesInstallDeploymentInput,
  materializedDirectory: string,
): Promise<KubernetesInstallHelmMaterial> {
  const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
  const imageTrustValuesPath: string = resolve(materializedDirectory, 'image-trust-values.json');
  const platformImageValuesPath: string = resolve(materializedDirectory, 'platform-image-values.json');
  const packagedVersion: string | undefined = resolvePackagedKubernetesPlatformVersion();
  await writeKubernetesInstallValues(
    platformImageValuesPath,
    packagedVersion === undefined ? {} : buildKubernetesPlatformImageVersionValues(packagedVersion),
  );
  await writeVerifiedKubernetesInstallImageValues({
    chartPath,
    overrideValuesPaths: [platformImageValuesPath, input.valuesPath],
    outputPath: imageTrustValuesPath,
  });
  return {
    chartPath,
    imageTrustValuesPath,
    installValuesPath: resolve(materializedDirectory, 'install-values.json'),
    platformImageValuesPath,
  };
}
