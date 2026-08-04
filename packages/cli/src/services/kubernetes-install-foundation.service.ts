import { buildPrivateRegistryHost } from '@compartment/contracts';
import { runKubernetesHelmInstallStage, writeKubernetesInstallValues } from './kubernetes-install-helm.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { readExistingKubernetesInstall } from './kubernetes-install-release.service';
import { mergeRetainedKubernetesInstallState } from './kubernetes-install-retained-state.service';
import { requireFoundationInstall } from './kubernetes-install-runtime.support';
import { buildInitialInstallValues, buildResumableFoundationValues } from './kubernetes-install-state.service';
import { requireManagedBrokerUrl } from './kubernetes-install-managed-state.support';
import { applyKubernetesConfiguredIngressState } from './kubernetes-install-state-ingress.service';
import { readRegistryServiceAddresses } from './kubernetes-install-registry-service.service';
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
  const registryHostname: string =
    input.registryHostname === ''
      ? buildPrivateRegistryHost((await readRegistryServiceAddresses(input))[0]!)
      : input.registryHostname;
  const state: KubernetesInstallState = buildResumableState(input, installationId, existingState, registryHostname);
  await writeKubernetesInstallValues(material.installValuesPath, buildResumableFoundationValues(state, installToken));
  await runFoundationHelmInstall(input, material);
}

function buildResumableState(
  input: KubernetesInstallDeploymentInput,
  installationId: string,
  existingState: KubernetesInstallState,
  registryHostname: string,
): KubernetesInstallState {
  return applyKubernetesConfiguredIngressState(input, {
    ...existingState,
    acmeEmail: input.acmeEmail,
    brokerUrl:
      input.domainMode === 'managed' && existingState.brokerUrl.trim() === ''
        ? requireManagedBrokerUrl(input.brokerUrl)
        : existingState.brokerUrl,
    ingressClassName: input.ingressClassName,
    installationId,
    registryHostname,
    registryIssuerRef: input.registryIssuerRef.name === '' ? existingState.registryIssuerRef : input.registryIssuerRef,
  });
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
