import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertMatchingKubernetesInstallDomain,
  resolveKubernetesInstallControlPlaneUrl,
} from '../kubernetes-install-domain';
import {
  createKubernetesInstallMaterializedDirectory,
  resolveKubernetesChartPath,
  runKubernetesHelmInstallStage,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { waitForPublicControlPlane } from './kubernetes-install-public.service';
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
  KubernetesInstallState,
  RetainedKubernetesInstallState,
} from './kubernetes-install.service.types';

const installTokenByteLength: number = 32;

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
  const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
  const installValuesPath: string = resolve(materializedDirectory, 'install-values.json');
  await ensureKubernetesFoundation(
    input,
    existingRelease,
    retainedState,
    chartPath,
    installValuesPath,
    installToken,
    installationId,
  );
  const foundationInstall: ExistingKubernetesInstall = await readFoundationInstall(input, retainedState);
  const state: KubernetesInstallState = await resolveKubernetesInstallState(input, foundationInstall);
  await persistResolvedInstallState(input, chartPath, installValuesPath, installToken, state);
  const apiUrl: string = await deployFullKubernetesInstall(input, chartPath, installValuesPath, state);
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
  chartPath: string,
  installValuesPath: string,
  installToken: string,
  installationId: string,
): Promise<void> {
  if (existingRelease === null && retainedState === null) {
    await deployInitialFoundation(input, chartPath, installValuesPath, installToken, installationId);
    return;
  }
  const existingState: KubernetesInstallState | null = retainedState ?? existingRelease;
  if (existingState === null) {
    throw new Error('Expected an existing foundation release or retained install state.');
  }
  await deployResumableFoundation(input, chartPath, installValuesPath, installToken, installationId, existingState);
}

async function deployResumableFoundation(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  installToken: string,
  installationId: string,
  existingState: KubernetesInstallState,
): Promise<void> {
  const state: KubernetesInstallState = { ...existingState, installationId };
  await writeKubernetesInstallValues(installValuesPath, buildResumableFoundationValues(state, installToken));
  await runKubernetesHelmInstallStage(input, chartPath, installValuesPath, 'foundation');
}

async function deployInitialFoundation(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  installToken: string,
  installationId: string,
): Promise<void> {
  await writeKubernetesInstallValues(installValuesPath, buildInitialInstallValues(input, installToken, installationId));
  await runKubernetesHelmInstallStage(input, chartPath, installValuesPath, 'foundation');
}

async function persistResolvedInstallState(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  installToken: string,
  state: KubernetesInstallState,
): Promise<void> {
  await writeKubernetesInstallValues(installValuesPath, buildResolvedInstallValues(state, installToken));
  await runKubernetesHelmInstallStage(input, chartPath, installValuesPath, 'foundation');
}

async function deployFullKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  state: KubernetesInstallState,
): Promise<string> {
  const apiUrl: string = resolveKubernetesInstallControlPlaneUrl(input.apiUrl, state.baseDomain, state.publicProtocol);
  await runKubernetesHelmInstallStage(input, chartPath, installValuesPath, 'full');
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
    const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
    const installValuesPath: string = resolve(materializedDirectory, 'install-values.json');
    await writeKubernetesInstallValues(installValuesPath, buildResolvedInstallValues(state, installToken));
    await runKubernetesHelmInstallStage(input, chartPath, installValuesPath, 'full');
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
}

async function finishKubernetesInstall(
  apiUrl: string,
  installToken: string,
  baseDomain: string,
): Promise<KubernetesInstallDeploymentResult> {
  await waitForPublicControlPlane(apiUrl);
  return { apiUrl, baseDomain, installToken };
}

function requireFoundationInstall(existingInstall: ExistingKubernetesInstall | null): ExistingKubernetesInstall {
  if (existingInstall?.stage === 'foundation') {
    return existingInstall;
  }
  throw new Error('The Helm foundation stage did not persist a resumable installation state.');
}

function requireExistingInstallToken(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.installToken !== null) {
    return existingInstall.installToken;
  }
  throw new Error(
    'The existing full Helm release has no resumable install token. Use login if it is initialized, or set secrets.installToken through the operator workflow.',
  );
}

function requireExistingBaseDomain(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.baseDomain !== '') {
    return existingInstall.baseDomain;
  }
  throw new Error('The existing full Helm release has no resolved base domain.');
}

function readInstallationId(existingInstall: ExistingKubernetesInstall | null): string | null {
  return existingInstall !== null && existingInstall.installationId !== '' ? existingInstall.installationId : null;
}

function createInstallToken(): string {
  return randomBytes(installTokenByteLength).toString('hex');
}
