import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readSeaAssetBuffer } from '../sea';
import {
  buildHelmCommand,
  buildKubectlCommand,
  formatKubernetesShellCommand,
  formatKubernetesCommandExecutionFailure,
  readCommandOutput,
} from './kubernetes-command.support';
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
const helmRollbackTimeout: string = '8m';

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
  recoveryRevision: number | null = null,
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
    await throwHelmInstallError(input, stage, result, startedAt, recoveryRevision);
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
  const args: string[] = buildHelmCommand(input, [
    ...buildHelmBaseCommand(input, chartPath, platformImageValuesPath, installValuesPath, imageTrustValuesPath),
    '--set',
    `platform.startupStage=${stage}`,
  ]);
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
    'upgrade',
    '--install',
    input.releaseName,
    chartPath,
    '--namespace',
    input.namespace,
    '--create-namespace',
    ...buildHelmInstallValuesArgs(input, platformImageValuesPath, installValuesPath, imageTrustValuesPath),
    '--force-conflicts',
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
  recoveryRevision: number | null,
): Promise<never> {
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(
    `Helm ${stage} install failed`,
    result,
  );
  if (executionFailure !== undefined) {
    const recovery: string = await recoverFailedUpgrade(input, recoveryRevision);
    throw new Error(`${executionFailure}${recovery}`);
  }
  const output: string = readCommandOutput(result);
  if (/timed out|deadline exceeded/u.test(output.toLowerCase())) {
    await throwHelmTimeoutError(input, stage, output, startedAt, recoveryRevision);
  }
  const recovery: string = await recoverFailedUpgrade(input, recoveryRevision);
  throw new Error(
    `Helm ${stage} install failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}${recovery}`,
  );
}

async function throwHelmTimeoutError(
  input: KubernetesInstallDeploymentInput,
  stage: KubernetesInstallStage,
  output: string,
  startedAt: number,
  recoveryRevision: number | null,
): Promise<never> {
  const notReadyPods: string = await readNotReadyPods(input);
  const recovery: string = await recoverFailedUpgrade(input, recoveryRevision);
  const elapsedSeconds: string = Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)).toString();
  throw new Error(
    `Timed out waiting for ${stage === 'foundation' ? 'foundation workloads' : 'platform pods'} after ${elapsedSeconds}s.${output === '' ? '' : `\n${output}`}\nNon-Ready pods: ${notReadyPods}. Check with \`kubectl get pods -n ${input.namespace}\`.${recovery}`,
  );
}

async function recoverFailedUpgrade(
  input: KubernetesInstallDeploymentInput,
  recoveryRevision: number | null,
): Promise<string> {
  if (recoveryRevision === null) {
    return ` The installation remains incomplete. Inspect it with \`${formatKubernetesShellCommand(
      buildHelmCommand(input, ['status', input.releaseName, '--namespace', input.namespace]),
    )}\`, then re-run compartment install to resume.`;
  }
  const rollbackCommand: string[] = buildRollbackCommand(input, recoveryRevision);
  const rollbackResult: CommandResult = await runCommandWithTimeout(rollbackCommand, helmInstallProcessTimeoutMs);
  if (rollbackResult.exitCode === 0) {
    return ` Helm restored revision ${recoveryRevision.toString()}; the release is deployed again. Fix the reported cause, then re-run compartment install.`;
  }
  return formatFailedRollback(rollbackCommand, rollbackResult, recoveryRevision);
}

function buildRollbackCommand(input: KubernetesInstallDeploymentInput, recoveryRevision: number): string[] {
  return buildHelmCommand(input, [
    'rollback',
    input.releaseName,
    recoveryRevision.toString(),
    '--namespace',
    input.namespace,
    '--wait',
    '--timeout',
    helmRollbackTimeout,
    '--force-conflicts',
  ]);
}

function formatFailedRollback(
  rollbackCommand: readonly string[],
  rollbackResult: CommandResult,
  recoveryRevision: number,
): string {
  const recoveryCommand: string = formatKubernetesShellCommand(rollbackCommand);
  const rollbackOutput: string = readCommandOutput(rollbackResult);
  return ` Automatic rollback to revision ${recoveryRevision.toString()} failed${rollbackOutput === '' ? '.' : `:\n${rollbackOutput}`} Recover with \`${recoveryCommand}\`, then re-run compartment install.`;
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
