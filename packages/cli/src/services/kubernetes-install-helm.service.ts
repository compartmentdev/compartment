import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readSeaAssetBuffer } from '../sea';
import { buildHelmKubeContextArgs, buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallStage,
  KubernetesPodList,
  KubernetesPodListItem,
  KubernetesPodStatusCondition,
} from './kubernetes-install.service.types';

const bundledKubernetesChartAssetName: string = 'compartment-chart.tgz';
const helmInstallTimeout: string = '8m';
const helmInstallProcessTimeoutMs: number = 9 * 60_000;

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
  platformImageValuesPath: string,
  installValuesPath: string,
  imageTrustValuesPath: string,
  stage: KubernetesInstallStage,
): Promise<void> {
  const command: string[] = buildHelmInstallCommand(
    input,
    chartPath,
    platformImageValuesPath,
    installValuesPath,
    imageTrustValuesPath,
    stage,
  );
  const startedAt: number = Date.now();
  const result: CommandResult = await runCommandWithTimeout(command, helmInstallProcessTimeoutMs);
  if (result.exitCode !== 0) {
    await throwHelmInstallError(input, stage, result, startedAt);
  }
}

function buildHelmInstallCommand(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  platformImageValuesPath: string,
  installValuesPath: string,
  imageTrustValuesPath: string,
  stage: KubernetesInstallStage,
): string[] {
  const args: string[] = buildHelmBaseCommand(
    input,
    chartPath,
    platformImageValuesPath,
    installValuesPath,
    imageTrustValuesPath,
  );
  args.push('--set', `platform.startupStage=${stage}`);
  args.push(...buildHelmKubeContextArgs(input));
  if (stage === 'full') {
    args.push('--wait-for-jobs');
  }
  return args;
}

function buildHelmBaseCommand(
  input: KubernetesInstallDeploymentInput,
  chartPath: string,
  platformImageValuesPath: string,
  installValuesPath: string,
  imageTrustValuesPath: string,
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
    ...buildHelmInstallValuesArgs(input, platformImageValuesPath, installValuesPath, imageTrustValuesPath),
    '--rollback-on-failure',
    '--wait',
    '--timeout',
    helmInstallTimeout,
  ];
}

function buildHelmInstallValuesArgs(
  input: KubernetesInstallDeploymentInput,
  platformImageValuesPath: string,
  installValuesPath: string,
  imageTrustValuesPath: string,
): string[] {
  return buildKubernetesHelmValuesArgs([
    platformImageValuesPath,
    input.valuesPath,
    installValuesPath,
    imageTrustValuesPath,
  ]);
}

export function buildKubernetesHelmValuesArgs(valuesPaths: readonly string[]): string[] {
  return valuesPaths.flatMap((valuesPath: string): string[] => ['--values', resolve(valuesPath)]);
}

async function throwHelmInstallError(
  input: KubernetesInstallDeploymentInput,
  stage: KubernetesInstallStage,
  result: CommandResult,
  startedAt: number,
): Promise<never> {
  const output: string = readCommandOutput(result);
  if (/timed out|deadline exceeded/u.test(output.toLowerCase())) {
    const notReadyPods: string = await readNotReadyPods(input);
    throw new Error(
      `Timed out waiting for ${stage === 'foundation' ? 'foundation workloads' : 'platform pods'} after ${Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)).toString()}s.${output === '' ? '' : `\n${output}`}\nNon-Ready pods: ${notReadyPods}. Check with \`kubectl get pods -n ${input.namespace}\` and re-run install to resume.`,
    );
  }
  throw new Error(
    `Helm ${stage} install failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
  );
}

async function readNotReadyPods(input: KubernetesInstallDeploymentInput): Promise<string> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['--request-timeout=10s', 'get', 'pods', '--output', 'json']),
    15_000,
  );
  if (result.exitCode !== 0) {
    return `unable to inspect (${readCommandOutput(result)})`;
  }
  try {
    const pods: KubernetesPodList = JSON.parse(result.stdout) as KubernetesPodList;
    return formatNotReadyPods(pods);
  } catch {
    return 'unable to parse kubectl output';
  }
}

function formatNotReadyPods(pods: KubernetesPodList): string {
  const descriptions: string[] = pods.items
    .filter(
      (pod: KubernetesPodListItem): boolean =>
        pod.status?.conditions?.some(
          (condition: KubernetesPodStatusCondition): boolean =>
            condition.type === 'Ready' && condition.status === 'True',
        ) !== true,
    )
    .map(
      (pod: KubernetesPodListItem): string =>
        `${pod.metadata?.name ?? '<unknown>'} (${pod.status?.phase ?? 'Unknown'})`,
    );
  return descriptions.length === 0 ? 'none reported by Kubernetes' : descriptions.join(', ');
}
