import type {
  DeploymentMetricsSnapshot,
  PodResourceMetric,
  WorkerPodResourceMetric,
  WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import type { DeploymentSummaryInput } from './presenter.types';

const staleAfterMs: number = 30_000;
let currentSnapshot: WorkerPublishPodMetricsRequest | null = null;

export function publishPodMetricsSnapshot(input: WorkerPublishPodMetricsRequest): void {
  currentSnapshot = input;
}

export function readPodMetricsSnapshot(deployments: DeploymentSummaryInput[]): DeploymentMetricsSnapshot {
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
  const pods: PodResourceMetric[] = snapshot.pods.flatMap((pod: WorkerPodResourceMetric): PodResourceMetric[] => {
    const deployment: DeploymentSummaryInput | undefined = deploymentById.get(pod.deploymentId);
    return deployment === undefined ? [] : [{ ...pod, serviceName: deployment.service.name }];
  });
  return {
    observedAt: snapshot.observedAt,
    pods,
    state: Date.now() - Date.parse(snapshot.observedAt) > staleAfterMs ? 'stale' : 'available',
  };
}
