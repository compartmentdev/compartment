import type {
  ProductJobIntent,
  ProductJobResourceReadiness,
  ResourceReachabilityEndpoint,
} from '@compartment/contracts';
import {
  resourceReachabilityTargetsEnvironmentName,
  type ResourceReachabilityTarget,
} from './resource-reachability-probe.types';
import type { KubeResourceReachabilityProbe } from '@compartment/kube-runtime';
import { kubeResourceServiceDns } from '@compartment/utils';

const probeCommand: readonly string[] = ['node', 'dist/await-resources-job.js'];

/**
 * Builds the init container that holds a tenant Pod pre-Running until the resources it dials answer.
 *
 * The image is the worker's own, so the probe adds no image to the installation and inherits whatever pull
 * authorization already lets this cluster run Compartment. `boundMs` clamps every declared budget: a Job may not
 * spend more waiting than it has left to run, and past that bound the probe fails naming the endpoint instead of
 * letting Kubernetes report an anonymous deadline.
 */
export function resourceReachabilityProbe(
  endpoints: readonly ResourceReachabilityEndpoint[],
  namespaceId: string,
  workerImage: string,
  boundMs?: number,
): KubeResourceReachabilityProbe | undefined {
  if (endpoints.length === 0) {
    return undefined;
  }
  const targets: ResourceReachabilityTarget[] = endpoints.map(
    (endpoint: ResourceReachabilityEndpoint): ResourceReachabilityTarget => ({
      host: kubeResourceServiceDns(endpoint.resourceId, namespaceId),
      port: endpoint.port,
      timeoutMs: boundMs === undefined ? endpoint.timeoutMs : Math.min(endpoint.timeoutMs, boundMs),
    }),
  );
  return {
    command: [...probeCommand],
    env: { [resourceReachabilityTargetsEnvironmentName]: JSON.stringify(targets) },
    image: workerImage,
  };
}

/**
 * A Job may not wait longer for a resource than it has left to run. Without the clamp Kubernetes ends the Pod on
 * `activeDeadlineSeconds` and reports an anonymous deadline; with it the probe fails first and names the endpoint.
 */
export function productJobResourceProbe(
  intent: ProductJobIntent,
  resourceReadiness: readonly ProductJobResourceReadiness[],
  workerImage: string,
): KubeResourceReachabilityProbe | undefined {
  return resourceReachabilityProbe(resourceReadiness, namespaceIdOf(intent), workerImage, intent.timeoutMs);
}

/**
 * Tenant namespaces are named after the project, and a Job's namespace is that name. The probe needs the
 * namespace id the resource Service DNS is derived from, which is the same project id the intent carries.
 */
function namespaceIdOf(intent: ProductJobIntent): string {
  return intent.projectId;
}
