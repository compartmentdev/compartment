import { runKubernetesHelmInstallStage, writeKubernetesInstallValues } from './kubernetes-install-helm.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { readExistingKubernetesInstall } from './kubernetes-install-release.service';
import { mergeRetainedKubernetesInstallState } from './kubernetes-install-retained-state.service';
import { requireFoundationInstall } from './kubernetes-install-runtime.support';
import { buildInitialInstallValues, buildResumableFoundationValues } from './kubernetes-install-state.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
  KubernetesInstallState,
  RetainedKubernetesInstallState,
} from './kubernetes-install.service.types';

export async function installObservableKubernetesFoundation(
  input: KubernetesInstallDeploymentInput,
  existingRelease: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  installationId: string,
): Promise<ExistingKubernetesInstall> {
  return await runObservableInstallStep(
    input.progress,
    'Installing foundation (postgres, registry)',
    async (): Promise<ExistingKubernetesInstall> => {
      await ensureKubernetesFoundation(input, existingRelease, retainedState, material, installToken, installationId);
      return await readFoundationInstall(input, retainedState);
    },
  );
}

async function readFoundationInstall(
  input: KubernetesInstallDeploymentInput,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<ExistingKubernetesInstall> {
  const existingInstall: ExistingKubernetesInstall | null = await readExistingKubernetesInstall(input);
  return requireFoundationInstall(mergeRetainedKubernetesInstallState(existingInstall, retainedState));
}

async function ensureKubernetesFoundation(
  input: KubernetesInstallDeploymentInput,
  existingRelease: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  installationId: string,
): Promise<void> {
  if (retainedState === null) {
    if (existingRelease !== null) {
      throw new Error('Cannot resume a Helm release without canonical retained install state.');
    }
    await deployInitialFoundation(input, material, installToken, installationId);
    return;
  }
  await deployResumableFoundation(input, material, installToken, installationId, retainedState);
}

async function deployResumableFoundation(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  installationId: string,
  existingState: KubernetesInstallState,
): Promise<void> {
  const state: KubernetesInstallState = { ...existingState, installationId };
  await writeKubernetesInstallValues(material.installValuesPath, buildResumableFoundationValues(state, installToken));
  await runFoundationHelmInstall(input, material);
}

async function deployInitialFoundation(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  installationId: string,
): Promise<void> {
  await writeKubernetesInstallValues(
    material.installValuesPath,
    buildInitialInstallValues(input, installToken, installationId),
  );
  await runFoundationHelmInstall(input, material);
}

async function runFoundationHelmInstall(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
): Promise<void> {
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
  );
}
