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
  if (existingRelease === null && retainedState === null) {
    await deployInitialFoundation(input, material, installToken, installationId);
    return;
  }
  const existingState: KubernetesInstallState | null = retainedState ?? existingRelease;
  if (existingState === null) {
    throw new Error('Expected an existing foundation release or retained install state.');
  }
  await deployResumableFoundation(input, material, installToken, installationId, existingState);
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
