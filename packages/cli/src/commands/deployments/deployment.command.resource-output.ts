import type { DeploymentStatusResponse, PodResourceMetric, ResourceSummary } from '@compartment/contracts';
import type { DeploymentStatusView } from '../../services/deployments.types';

export function appendPodMetrics(baseMessage: string, response: DeploymentStatusView): string {
  if (response.metrics.state === 'unavailable') {
    return `${baseMessage}\nPod metrics: unavailable.`;
  }
  const freshness: string = response.metrics.state === 'stale' ? ' (stale)' : '';
  if (response.metrics.pods.length === 0) {
    return `${baseMessage}\nPod metrics${freshness}: no product Pod samples.`;
  }
  const lines: string = response.metrics.pods
    .map(
      (pod: PodResourceMetric): string =>
        `${pod.serviceName}/${pod.podName}: ${pod.cpuMillicores.toFixed(3)}m CPU, ${formatMemoryMiB(pod.memoryBytes)} MiB RAM`,
    )
    .join('\n');
  return `${baseMessage}\nPod metrics${freshness}:\n${lines}`;
}

export function appendResourceSummary(baseMessage: string, response: DeploymentStatusResponse): string {
  const resources: ResourceSummary[] | undefined = readDeployResources(response);
  if (resources === undefined || resources.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n${resources
    .map((resource: ResourceSummary): string => `Resource ${resource.name} is ${resource.status}.`)
    .join('\n')}`;
}

function formatMemoryMiB(memoryBytes: number): string {
  return (memoryBytes / 1_048_576).toFixed(2);
}

function readDeployResources(response: DeploymentStatusResponse): ResourceSummary[] | undefined {
  return 'resources' in response && Array.isArray(response.resources)
    ? (response.resources as ResourceSummary[])
    : undefined;
}
