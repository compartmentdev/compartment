import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readSeaAssetBuffer } from '../sea';
import type { KubernetesInstallDeploymentInput, KubernetesInstallStage } from './kubernetes-install.service.types';

const bundledKubernetesChartAssetName: string = 'compartment-chart.tgz';
const helmInstallTimeout: string = '15m';

export async function createKubernetesInstallMaterializedDirectory(): Promise<string> {
  return await mkdtemp(resolve(tmpdir(), 'compartment-install-'));
}

export async function writeKubernetesInstallValues(path: string, values: object): Promise<void> {
  await writeFile(path, JSON.stringify(values), { mode: 0o600 });
}

export async function resolveKubernetesChartPath(
  input: Pick<KubernetesInstallDeploymentInput, 'chartPath'>,
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

export async function runKubernetesHelmInstallStage(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  stage: KubernetesInstallStage,
): Promise<void> {
  const command: string[] = buildHelmInstallCommand(input, chartPath, installValuesPath, stage);
  const result: CommandResult = await runCommand(command);
  if (result.exitCode !== 0) {
    throwHelmInstallError(stage, result);
  }
}

function buildHelmInstallCommand(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  installValuesPath: string,
  stage: KubernetesInstallStage,
): string[] {
  const args: string[] = buildHelmBaseCommand(input, chartPath, installValuesPath);
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

function throwHelmInstallError(stage: KubernetesInstallStage, result: CommandResult): never {
  const output: string = [result.stderr.trim(), result.stdout.trim()]
    .filter((value: string): boolean => value !== '')
    .join('\n');
  throw new Error(
    `Helm ${stage} install failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
  );
}
