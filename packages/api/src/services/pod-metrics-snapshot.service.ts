import type {
  DeploymentMetricsSnapshot,
  PodResourceMetric,
  WorkerPodResourceMetric,
  WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import type { DeploymentSummaryInput } from './presenter.types';

let currentSnapshot: WorkerPublishPodMetricsRequest | null = null;

export function publishPodMetricsSnapshot(input: WorkerPublishPodMetricsRequest): void {
  currentSnapshot = input;
}

export function readPodMetricsSnapshot(
  deployments: DeploymentSummaryInput[],
  staleAfterMs: number,
): DeploymentMetricsSnapshot {
  const snapshot: WorkerPublishPodMetricsRequest | null = currentSnapshot;
  if (snapshot === null || snapshot.state === 'unavailable') {
    return { observedAt: snapshot?.observedAt ?? null, pods: [], state: 'unavailable' };
  }
  const deploymentById: Map<string, DeploymentSummaryInput> = new Map<string, DeploymentSummaryInput>(
    deployments.map((deployment: DeploymentSummaryInput): [string, DeploymentSummaryInput] => [
      deployment.deployment.id,
      deployment,
    ]),
  );
  const pods: PodResourceMetric[] = snapshot.pods.flatMap((pod: WorkerPodResourceMetric): PodResourceMetric[] =>
    toDeploymentPodMetric(pod, deploymentById),
  );
  return {
    observedAt: snapshot.observedAt,
    pods,
    state: Date.now() - Date.parse(snapshot.observedAt) > staleAfterMs ? 'stale' : 'available',
  };
}

function toDeploymentPodMetric(
  pod: WorkerPodResourceMetric,
  deploymentById: ReadonlyMap<string, DeploymentSummaryInput>,
): PodResourceMetric[] {
  if (pod.kind === 'resource') {
    return [];
  }
  const deployment: DeploymentSummaryInput | undefined = deploymentById.get(pod.deploymentId);
  return deployment === undefined
    ? []
    : [
        {
          cpuMillicores: pod.cpuMillicores,
          deploymentId: pod.deploymentId,
          memoryBytes: pod.memoryBytes,
          namespace: pod.namespace,
          observedAt: pod.observedAt,
          podName: pod.podName,
          podUid: pod.podUid,
          serviceName: deployment.service.name,
        },
      ];
}
