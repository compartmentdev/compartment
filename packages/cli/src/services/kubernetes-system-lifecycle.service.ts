import {
  kubernetesSystemRestartResponseSchema,
  kubernetesSystemStatusResponseSchema,
  type KubernetesPlatformWorkloadStatus,
  type KubernetesSystemRestartResponse,
  type KubernetesSystemStatusResponse,
} from '@compartment/contracts';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, buildKubernetesReleaseSelector, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import { readKubernetesHelmReleaseStatus, readKubernetesPlatformWorkloads } from './kubernetes-system-status.service';

const rolloutTimeout: string = '10m';
const restartDeploymentSelectorComponents: string = 'app.kubernetes.io/component notin (postgres,registry)';

export async function restartKubernetesSystem(
  target: KubernetesOperatorTarget,
): Promise<KubernetesSystemRestartResponse> {
  const selector: string = `${buildKubernetesReleaseSelector(target.releaseName)},${restartDeploymentSelectorComponents}`;
  await runRequiredKubectl(
    target,
    ['rollout', 'restart', 'deployment', '--selector', selector],
    'Failed to restart Kubernetes platform workloads.',
  );
  await runRequiredKubectl(
    target,
    ['rollout', 'status', 'deployment', '--selector', selector, '--timeout', rolloutTimeout],
    'Kubernetes platform Deployment restart did not complete.',
  );
  const status: KubernetesSystemStatusResponse = await getKubernetesSystemStatus(target);
  return kubernetesSystemRestartResponseSchema.parse({ restarted: status.ready, status });
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
