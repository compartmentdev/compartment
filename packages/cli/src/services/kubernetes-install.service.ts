import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readSeaAssetBuffer } from '../sea';
import { readExistingKubernetesInstall } from './kubernetes-install-release.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallStage,
  PublicControlPlaneObservation,
} from './kubernetes-install.service.types';

const bundledKubernetesChartAssetName: string = 'compartment-chart.tgz';
const helmInstallTimeout: string = '15m';
const publicControlPlanePollIntervalMs: number = 2_000;
const publicControlPlaneRequestTimeoutMs: number = 10_000;
const publicControlPlaneWaitTimeoutMs: number = 15 * 60_000;
const installTokenByteLength: number = 32;

export async function deployAndWaitForKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<KubernetesInstallDeploymentResult> {
  const existingInstall: ExistingKubernetesInstall | null = await readExistingKubernetesInstall(input);
  if (existingInstall !== null) {
    requireMatchingExistingBaseDomain(input, existingInstall);
  }
  if (existingInstall?.stage === 'full') {
    return await resumeKubernetesOwnerBootstrap(input, existingInstall);
  }

  return await deployKubernetesInstall(input, existingInstall);
}

async function deployKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall | null,
): Promise<KubernetesInstallDeploymentResult> {
  const installToken: string = existingInstall?.installToken ?? createInstallToken();
  const materializedDirectory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-'));

  try {
    const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
    const installValuesPath: string = resolve(materializedDirectory, 'install-values.json');
    await writeFile(installValuesPath, JSON.stringify({ secrets: { installToken } }), { mode: 0o600 });
    if (existingInstall === null) {
      await runHelmInstallStage(input, chartPath, installValuesPath, 'foundation');
    }
    await runHelmInstallStage(input, chartPath, installValuesPath, 'full');
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }

  await waitForPublicControlPlane(input.apiUrl);
  return { installToken };
}

async function resumeKubernetesOwnerBootstrap(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallDeploymentResult> {
  const installToken: string = requireExistingInstallToken(existingInstall);
  await waitForPublicControlPlane(input.apiUrl);
  return { installToken };
}

async function resolveKubernetesChartPath(
  input: KubernetesInstallDeploymentInput,
  materializedDirectory: string,
): Promise<string> {
  if (input.chartPath !== undefined) {
    return input.chartPath;
  }
  const chartArchive: Buffer | undefined = readSeaAssetBuffer(bundledKubernetesChartAssetName);
  if (chartArchive === undefined) {
    throw new Error('This CLI build does not include the Kubernetes chart. Pass --chart <path>.');
  }

  const chartPath: string = resolve(materializedDirectory, bundledKubernetesChartAssetName);
  await writeFile(chartPath, chartArchive, { mode: 0o600 });
  return chartPath;
}

async function runHelmInstallStage(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  stage: KubernetesInstallStage,
): Promise<void> {
  const result: CommandResult = await runCommand(buildHelmInstallCommand(input, chartPath, installValuesPath, stage));
  if (result.exitCode !== 0) {
    const output: string = [result.stderr.trim(), result.stdout.trim()]
      .filter((value: string): boolean => value !== '')
      .join('\n');
    throw new Error(
      `Helm ${stage} install failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
    );
  }
}

function buildHelmInstallCommand(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  stage: KubernetesInstallStage,
): string[] {
  const args: string[] = buildHelmBaseCommand(input, chartPath, installValuesPath);
  args.push('--set-string', `platform.baseDomain=${input.baseDomain}`);
  args.push('--set', `platform.startupStage=${stage}`);
  if (input.kubeContext !== undefined) {
    args.push('--kube-context', input.kubeContext);
  }
  if (stage === 'full') {
    args.push('--wait-for-jobs');
  }
  return args;
}

function buildHelmBaseCommand(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
): string[] {
  return [
    'helm',
    'upgrade',
    '--install',
    input.releaseName,
    chartPath,
    '--namespace',
    input.namespace,
    '--create-namespace',
    '--values',
    resolve(input.valuesPath),
    '--values',
    installValuesPath,
    '--rollback-on-failure',
    '--wait',
    '--timeout',
    helmInstallTimeout,
  ];
}

function requireExistingInstallToken(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.installToken !== null) {
    return existingInstall.installToken;
  }
  throw new Error(
    'The existing full Helm release has no resumable install token. Use login if it is initialized, or set secrets.installToken through the operator workflow.',
  );
}

function requireMatchingExistingBaseDomain(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): void {
  if (existingInstall.baseDomain === input.baseDomain) {
    return;
  }
  throw new Error(
    `The existing Helm release uses base domain ${existingInstall.baseDomain}, not ${input.baseDomain}. Retry with the installed base domain or use a different release name.`,
  );
}

function createInstallToken(): string {
  return randomBytes(installTokenByteLength).toString('hex');
}

async function waitForPublicControlPlane(apiUrl: string): Promise<void> {
  const deadline: number = Date.now() + publicControlPlaneWaitTimeoutMs;
  let lastFailure: string = 'no response';

  while (Date.now() < deadline) {
    try {
      const observation: PublicControlPlaneObservation = await observePublicControlPlane(apiUrl);
      if (observation.ready) {
        return;
      }
      lastFailure = observation.failure;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'network request failed';
    }

    await sleep(publicControlPlanePollIntervalMs);
  }

  throw new Error(`Timed out waiting for the public Compartment control plane at ${apiUrl}: ${lastFailure}`);
}

async function observePublicControlPlane(apiUrl: string): Promise<PublicControlPlaneObservation> {
  const response: Response = await fetch(apiUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(publicControlPlaneRequestTimeoutMs),
  });
  const location: string | null = response.headers.get('location');
  const ready: boolean = response.status === 302 && location === '/login';
  await response.body?.cancel();
  return {
    failure: `HTTP ${response.status.toString()} with location ${location ?? '<none>'}`,
    ready,
  };
}
