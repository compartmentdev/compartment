import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  kubernetesSystemRestartResponseSchema,
  kubernetesSystemStatusResponseSchema,
  kubernetesSystemUpdateResponseSchema,
  type KubernetesPlatformWorkloadStatus,
  type KubernetesSystemRestartResponse,
  type KubernetesSystemStatusResponse,
  type KubernetesSystemUpdateResponse,
} from '@compartment/contracts';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  buildHelmKubeContextArgs,
  buildKubectlCommand,
  buildKubernetesReleaseSelector,
  readCommandOutput,
} from './kubernetes-command.support';
import {
  buildKubernetesHelmValuesArgs,
  createKubernetesInstallMaterializedDirectory,
  resolveKubernetesChartPath,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { writeVerifiedKubernetesReleaseImageValues } from './kubernetes-image-trust.service';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import type {
  KubernetesPlatformUpdateImageValue,
  KubernetesPlatformUpdateImageValues,
  KubernetesSystemUpdateInput,
} from './kubernetes-system-lifecycle.service.types';
import { readKubernetesHelmReleaseStatus, readKubernetesPlatformWorkloads } from './kubernetes-system-status.service';

const helmUpdateTimeout: string = '15m';
const rolloutTimeout: string = '10m';

export async function restartKubernetesSystem(
  target: KubernetesOperatorTarget,
): Promise<KubernetesSystemRestartResponse> {
  const selector: string = buildKubernetesReleaseSelector(target.releaseName);
  await runRequiredKubectl(
    target,
    ['rollout', 'restart', 'deployment,daemonset', '--selector', selector],
    'Failed to restart Kubernetes platform workloads.',
  );
  await runRequiredKubectl(
    target,
    ['rollout', 'status', 'deployment', '--selector', selector, '--timeout', rolloutTimeout],
    'Kubernetes platform Deployment restart did not complete.',
  );
  await runRequiredKubectl(
    target,
    ['rollout', 'status', 'daemonset', '--selector', selector, '--timeout', rolloutTimeout],
    'Kubernetes platform DaemonSet restart did not complete.',
  );
  const status: KubernetesSystemStatusResponse = await getKubernetesSystemStatus(target);
  return kubernetesSystemRestartResponseSchema.parse({ restarted: status.ready, status });
}

export async function updateKubernetesSystem(
  input: KubernetesSystemUpdateInput,
): Promise<KubernetesSystemUpdateResponse> {
  const valuesPath: string = requireUpdateValuesPath(input.valuesPath);
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    await applyMaterializedKubernetesUpdate(input, valuesPath, materializedDirectory);
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
  const status: KubernetesSystemStatusResponse = await getKubernetesSystemStatus(input);
  return kubernetesSystemUpdateResponseSchema.parse({ status, updated: status.ready, version: input.version });
}

export async function getKubernetesSystemStatus(
  target: KubernetesOperatorTarget,
): Promise<KubernetesSystemStatusResponse> {
  const [releaseStatus, workloads]: [string, KubernetesPlatformWorkloadStatus[]] = await Promise.all([
    readKubernetesHelmReleaseStatus(target),
    readKubernetesPlatformWorkloads(target),
  ]);
  return kubernetesSystemStatusResponseSchema.parse({
    ready:
      releaseStatus === 'deployed' &&
      workloads.length > 0 &&
      workloads.every((workload: KubernetesPlatformWorkloadStatus): boolean => workload.ready),
    releaseName: target.releaseName,
    releaseStatus,
    workloads,
  });
}

async function applyMaterializedKubernetesUpdate(
  input: KubernetesSystemUpdateInput,
  valuesPath: string,
  materializedDirectory: string,
): Promise<void> {
  const chartPath: string = await resolveKubernetesChartPath(input, materializedDirectory);
  const updateValuesPath: string = resolve(materializedDirectory, 'update-values.json');
  const imageTrustValuesPath: string = resolve(materializedDirectory, 'image-trust-values.json');
  await writeKubernetesInstallValues(updateValuesPath, buildPlatformUpdateValues(input.version));
  await writeVerifiedKubernetesReleaseImageValues({
    ...(input.kubeContext === undefined ? {} : { kubeContext: input.kubeContext }),
    namespace: input.namespace,
    outputPath: imageTrustValuesPath,
    operatorValuesPaths: [valuesPath, updateValuesPath],
    releaseName: input.releaseName,
  });
  const result: CommandResult = await runCommand(
    buildKubernetesUpdateHelmCommand(input, chartPath, valuesPath, updateValuesPath, imageTrustValuesPath),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Helm platform update failed: ${readCommandOutput(result)}`);
  }
}

function buildKubernetesUpdateHelmCommand(
  input: KubernetesSystemUpdateInput,
  chartPath: string,
  valuesPath: string,
  updateValuesPath: string,
  imageTrustValuesPath: string,
): string[] {
  return [
    'helm',
    'upgrade',
    input.releaseName,
    chartPath,
    '--namespace',
    input.namespace,
    '--reuse-values',
    ...buildKubernetesHelmValuesArgs([valuesPath, updateValuesPath, imageTrustValuesPath]),
    '--rollback-on-failure',
    '--wait',
    '--wait-for-jobs',
    '--timeout',
    helmUpdateTimeout,
    ...buildHelmKubeContextArgs(input),
  ];
}

function buildPlatformUpdateValues(version: string): KubernetesPlatformUpdateImageValues {
  const image: KubernetesPlatformUpdateImageValue = { digest: '', tag: version };
  return { images: { api: image, caddy: image, edge: image, worker: image } };
}

async function runRequiredKubectl(
  target: KubernetesOperatorTarget,
  args: readonly string[],
  errorMessage: string,
): Promise<void> {
  const result: CommandResult = await runCommand(buildKubectlCommand(target, args));
  if (result.exitCode !== 0) {
    throw new Error(`${errorMessage} ${readCommandOutput(result)}`.trim());
  }
}

function requireUpdateValuesPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('--values is required for a Kubernetes platform update.');
  }
  return value;
}
