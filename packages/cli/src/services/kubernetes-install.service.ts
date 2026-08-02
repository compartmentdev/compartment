import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  assertMatchingKubernetesInstallDomain,
  resolveKubernetesInstallControlPlaneUrl,
} from '../kubernetes-install-domain';
import { waitForKubernetesPlatformCertificates } from './kubernetes-install-certificate.service';
import { installObservableKubernetesFoundation } from './kubernetes-install-foundation.service';
import {
  createKubernetesInstallMaterializedDirectory,
  runKubernetesHelmInstallStage,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import { inspectKubernetesInstall } from './kubernetes-install-inspection.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import {
  createInstallToken,
  finishKubernetesInstall,
  requireExistingBaseDomain,
  requireExistingInstallToken,
} from './kubernetes-install-runtime.support';
import { mergeRetainedKubernetesInstallState } from './kubernetes-install-retained-state.service';
import { buildResolvedInstallValues, resolveKubernetesInstallState } from './kubernetes-install-state.service';
import {
  reportKubernetesInstallWarning,
  verifyKubernetesInstallRegistryNodePullForInstall,
  verifyObservableKubernetesRegistry,
} from './kubernetes-install-registry-warning.service';
import { usesOperatorOwnedKubernetesTlsSecret } from './kubernetes-install-tls.service';
import {
  inspectKubernetesInstallResumeValues,
  reportKubernetesInstallValuesReconciliation,
} from './kubernetes-install-values-reconciliation.service';
import type { KubernetesInstallValuesReconciliation } from './kubernetes-install-values-reconciliation.service.types';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallHelmMaterial,
  KubernetesInstallInspection,
  KubernetesInstallState,
  RetainedKubernetesInstallState,
} from './kubernetes-install.service.types';
import { assertConfiguredManagedDomainEndpoint } from './kubernetes-install-state-ingress.service';

export async function deployAndWaitForKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<KubernetesInstallDeploymentResult> {
  assertConfiguredManagedDomainEndpoint(input);
  const inspection: KubernetesInstallInspection = await inspectKubernetesInstall(input);
  const { existingInstall, releaseRevision, retainedState }: KubernetesInstallInspection = inspection;
  assertRetainedInstallState(existingInstall, retainedState);
  const effectiveInstall: ExistingKubernetesInstall | null = mergeRetainedKubernetesInstallState(
    existingInstall,
    retainedState,
  );
  assertMatchingInstallState(input, effectiveInstall);
  const reconciliation: KubernetesInstallValuesReconciliation | null = await inspectKubernetesInstallResumeValues(
    input,
    existingInstall,
    effectiveInstall,
    inspection.releaseValues,
  );
  if (canResumeOwnerBootstrap(existingInstall, effectiveInstall, reconciliation)) {
    return await resumeKubernetesOwnerBootstrap(input, effectiveInstall);
  }
  reportKubernetesInstallValuesReconciliation(input, reconciliation);
  return await deployKubernetesInstall(input, existingInstall, effectiveInstall, retainedState, releaseRevision);
}

function assertMatchingInstallState(
  input: KubernetesInstallDeploymentInput,
  matchingState: ExistingKubernetesInstall | null,
): void {
  if (matchingState !== null) {
    assertMatchingKubernetesInstallDomain(input, matchingState);
  }
}

function assertRetainedInstallState(
  existingInstall: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
): void {
  if (existingInstall !== null && retainedState === null) {
    throw new Error(
      'The existing Helm release has no canonical retained install state. Remove that preview release before installing.',
    );
  }
}

function canResumeOwnerBootstrap(
  existingInstall: ExistingKubernetesInstall | null,
  effectiveInstall: ExistingKubernetesInstall | null,
  reconciliation: KubernetesInstallValuesReconciliation | null,
): effectiveInstall is ExistingKubernetesInstall {
  return existingInstall?.stage === 'full' && effectiveInstall !== null && reconciliation?.required === false;
}

async function deployKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  existingRelease: ExistingKubernetesInstall | null,
  existingInstall: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
  recoveryRevision: number | null,
): Promise<KubernetesInstallDeploymentResult> {
  const installToken: string = existingInstall?.installToken ?? createInstallToken();
  const installationId: string = retainedState?.installationId ?? randomUUID();
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    return await deployMaterializedKubernetesInstall(
      input,
      existingRelease,
      retainedState,
      installToken,
      installationId,
      materializedDirectory,
      recoveryRevision,
    );
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
}

async function deployMaterializedKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  existingRelease: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
  installToken: string,
  installationId: string,
  materializedDirectory: string,
  recoveryRevision: number | null,
): Promise<KubernetesInstallDeploymentResult> {
  const material: KubernetesInstallHelmMaterial = await prepareObservableInstallMaterial(input, materializedDirectory);
  const foundationInstall: ExistingKubernetesInstall = await installObservableKubernetesFoundation(
    input,
    existingRelease,
    retainedState,
    material,
    installToken,
    installationId,
  );
  const state: KubernetesInstallState = await resolveKubernetesInstallState(input, foundationInstall);
  return await deployResolvedKubernetesInstall(input, material, installToken, state, recoveryRevision);
}

async function deployResolvedKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  state: KubernetesInstallState,
  recoveryRevision: number | null,
): Promise<KubernetesInstallDeploymentResult> {
  await runObservableInstallStep(
    input.progress,
    'Saving installation configuration',
    async (): Promise<void> =>
      await persistResolvedInstallState(input, material, installToken, state, recoveryRevision),
  );
  const apiUrl: string = await runObservableInstallStep(
    input.progress,
    'Waiting for platform pods (api, worker, caddy)',
    async (): Promise<string> => await deployFullKubernetesInstall(input, material, state, recoveryRevision),
  );
  const registryWarning: string | null = await verifyObservableKubernetesRegistry(input, state);
  reportKubernetesInstallWarning(input, registryWarning);
  return await finishKubernetesInstall(apiUrl, installToken, state.baseDomain, input.domainMode, input.progress);
}

async function prepareObservableInstallMaterial(
  input: KubernetesInstallDeploymentInput,
  materializedDirectory: string,
): Promise<KubernetesInstallHelmMaterial> {
  return await runObservableInstallStep(
    input.progress,
    'Preparing Helm chart and verifying images',
    async (): Promise<KubernetesInstallHelmMaterial> =>
      await prepareKubernetesInstallHelmMaterial(input, materializedDirectory),
  );
}

async function persistResolvedInstallState(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  state: KubernetesInstallState,
  recoveryRevision: number | null,
): Promise<void> {
  await writeKubernetesInstallValues(material.installValuesPath, buildResolvedInstallValues(state, installToken));
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
    recoveryRevision,
  );
}

async function deployFullKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  state: KubernetesInstallState,
  recoveryRevision: number | null,
): Promise<string> {
  const apiUrl: string = resolveKubernetesInstallControlPlaneUrl(input.apiUrl, state.baseDomain, state.publicProtocol);
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'full',
    recoveryRevision,
  );
  await waitForRequiredKubernetesPlatformCertificates(input, state);
  return apiUrl;
}

async function resumeKubernetesOwnerBootstrap(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallDeploymentResult> {
  const baseDomain: string = requireExistingBaseDomain(existingInstall);
  await waitForRequiredKubernetesPlatformCertificates(input, existingInstall);
  reportKubernetesInstallWarning(
    input,
    await verifyKubernetesInstallRegistryNodePullForInstall(input, existingInstall),
  );
  return await finishKubernetesInstall(
    resolveKubernetesInstallControlPlaneUrl(input.apiUrl, baseDomain, existingInstall.publicProtocol),
    requireExistingInstallToken(existingInstall),
    baseDomain,
    input.domainMode,
    input.progress,
  );
}

async function waitForRequiredKubernetesPlatformCertificates(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<void> {
  const usesOperatorTlsSecret: boolean =
    state.domainMode === 'custom' && (await usesOperatorOwnedKubernetesTlsSecret(input.valuesPath));
  if (state.publicProtocol !== 'https' || usesOperatorTlsSecret) {
    return;
  }
  await runObservableInstallStep(
    input.progress,
    'Waiting for platform Certificates',
    async (): Promise<void> => await waitForKubernetesPlatformCertificates(input),
  );
}
