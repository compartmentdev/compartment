import type { ProductJobResourceReadiness } from '@compartment/contracts';
import {
  kubeDeploymentAvailable,
  kubeResourceName,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';

/**
 * Connected resources that are not currently accepting connections, read straight from the API server
 * so a resource Pod replaced after the claim is seen as unavailable. This is one read round, never a
 * wait: the controller lane that would make a resource ready is the same lane that claims the Job.
 */
export async function readUnreadyProductJobResources(
  runtime: KubeRuntime,
  namespace: string,
  resources: readonly ProductJobResourceReadiness[],
): Promise<ProductJobResourceReadiness[]> {
  const unready: (ProductJobResourceReadiness | null)[] = await Promise.all(
    resources.map(async (resource: ProductJobResourceReadiness): Promise<ProductJobResourceReadiness | null> => {
      const observed: KubeObservedManifest | null = await runtime.read(
        resourceWorkloadIdentity(resource.resourceId, namespace),
      );
      return kubeDeploymentAvailable(observed) ? null : resource;
    }),
  );
  return unready.filter(
    (resource: ProductJobResourceReadiness | null): resource is ProductJobResourceReadiness => resource !== null,
  );
}

export function readExpiredProductJobResources(
  unready: readonly ProductJobResourceReadiness[],
  now: Date,
): ProductJobResourceReadiness[] {
  return unready.filter(
    (resource: ProductJobResourceReadiness): boolean => Date.parse(resource.deadlineAt) <= now.getTime(),
  );
}

function resourceWorkloadIdentity(resourceId: string, namespace: string): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: kubeResourceName(resourceId), namespace },
  };
}
