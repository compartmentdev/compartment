import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  assertMatchingKubernetesInstallDomain,
  resolveKubernetesInstallControlPlaneUrl,
} from '../kubernetes-install-domain';
import {
  createKubernetesInstallMaterializedDirectory,
  runKubernetesHelmInstallStage,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import {
  createInstallToken,
  finishKubernetesInstall,
  readInstallationId,
  requireExistingBaseDomain,
  requireExistingInstallToken,
  requireFoundationInstall,
} from './kubernetes-install-runtime.support';
import { readExistingKubernetesInstall } from './kubernetes-install-release.service';
import {
  mergeRetainedKubernetesInstallState,
  readRetainedKubernetesInstallState,
} from './kubernetes-install-retained-state.service';
import {
  buildInitialInstallValues,
  buildResumableFoundationValues,
  buildResolvedInstallValues,
  resolveKubernetesInstallState,
} from './kubernetes-install-state.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallHelmMaterial,
  KubernetesInstallState,
  RetainedKubernetesInstallState,
} from './kubernetes-install.service.types';

export async function deployAndWaitForKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<KubernetesInstallDeploymentResult> {
  const existingInstall: ExistingKubernetesInstall | null = await readExistingKubernetesInstall(input);
  const retainedState: RetainedKubernetesInstallState | null = await readRetainedKubernetesInstallState(input);
  const effectiveInstall: ExistingKubernetesInstall | null = mergeRetainedKubernetesInstallState(
    existingInstall,
    retainedState,
  );
  const matchingState: KubernetesInstallState | null = retainedState ?? effectiveInstall;
  if (matchingState !== null) {
    assertMatchingKubernetesInstallDomain(input, matchingState);
  }
  if (existingInstall?.stage === 'full' && effectiveInstall !== null) {
    return retainedState === null
      ? await adoptExistingKubernetesInstall(input, effectiveInstall)
      : await resumeKubernetesOwnerBootstrap(input, effectiveInstall);
  }
  return await deployKubernetesInstall(input, existingInstall, effectiveInstall, retainedState);
}

async function deployKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  existingRelease: ExistingKubernetesInstall | null,
  existingInstall: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
): Promise<KubernetesInstallDeploymentResult> {
  const installToken: string = existingInstall?.installToken ?? createInstallToken();
  const installationId: string = retainedState?.installationId ?? readInstallationId(existingInstall) ?? randomUUID();
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    return await deployMaterializedKubernetesInstall(
      input,
      existingRelease,
      retainedState,
      installToken,
      installationId,
      materializedDirectory,
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
): Promise<KubernetesInstallDeploymentResult> {
  const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(
    input,
    materializedDirectory,
  );
  await ensureKubernetesFoundation(input, existingRelease, retainedState, material, installToken, installationId);
  const foundationInstall: ExistingKubernetesInstall = await readFoundationInstall(input, retainedState);
  const state: KubernetesInstallState = await resolveKubernetesInstallState(input, foundationInstall);
  await persistResolvedInstallState(input, material, installToken, state);
  const apiUrl: string = await deployFullKubernetesInstall(input, material, state);
  return await finishKubernetesInstall(apiUrl, installToken, state.baseDomain);
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
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
  );
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
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
  );
}

async function persistResolvedInstallState(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  installToken: string,
  state: KubernetesInstallState,
): Promise<void> {
  await writeKubernetesInstallValues(material.installValuesPath, buildResolvedInstallValues(state, installToken));
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
  );
}

async function deployFullKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  material: KubernetesInstallHelmMaterial,
  state: KubernetesInstallState,
): Promise<string> {
  const apiUrl: string = resolveKubernetesInstallControlPlaneUrl(input.apiUrl, state.baseDomain, state.publicProtocol);
  await runKubernetesHelmInstallStage(
    input,
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'full',
  );
  return apiUrl;
}

async function resumeKubernetesOwnerBootstrap(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallDeploymentResult> {
  const baseDomain: string = requireExistingBaseDomain(existingInstall);
  return await finishKubernetesInstall(
    resolveKubernetesInstallControlPlaneUrl(input.apiUrl, baseDomain, existingInstall.publicProtocol),
    requireExistingInstallToken(existingInstall),
    baseDomain,
  );
}

async function adoptExistingKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallDeploymentResult> {
  const installToken: string = requireExistingInstallToken(existingInstall);
  const foundationInstall: ExistingKubernetesInstall = {
    ...existingInstall,
    installationId: readInstallationId(existingInstall) ?? randomUUID(),
  };
  const state: KubernetesInstallState = await resolveKubernetesInstallState(input, foundationInstall);
  const apiUrl: string = resolveKubernetesInstallControlPlaneUrl(input.apiUrl, state.baseDomain, state.publicProtocol);
  await materializeAdoptedKubernetesInstall(input, installToken, state);
  return await finishKubernetesInstall(apiUrl, installToken, state.baseDomain);
}

async function materializeAdoptedKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  installToken: string,
  state: KubernetesInstallState,
): Promise<void> {
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(
      input,
      materializedDirectory,
    );
    await writeKubernetesInstallValues(material.installValuesPath, buildResolvedInstallValues(state, installToken));
    await runKubernetesHelmInstallStage(
      input,
      material.chartPath,
      material.platformImageValuesPath,
      material.installValuesPath,
      material.imageTrustValuesPath,
      'full',
    );
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
}
