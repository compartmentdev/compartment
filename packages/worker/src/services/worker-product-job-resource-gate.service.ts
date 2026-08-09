import type { ProductJobIntent, ProductJobResourceReadiness } from '@compartment/contracts';
import {
  kubeDeploymentAvailable,
  kubeResourceName,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { persistProductJobFailure } from './worker-product-job-failure.service';

/**
 * Decides whether a claimed Job may be handed to Kubernetes now. A Job that dials a resource which is
 * not accepting connections is left claimable so the controller can move on and reconcile that resource;
 * it only becomes a durable failure once the resource has missed the readiness deadline it declared.
 *
 * This is a gate, not admission: `docs/specs/live-state-authority.md` reserves admission for the
 * Kubernetes control that can still refuse the Pod after this returns true.
 */
export async function passesProductJobResourceGate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  intent: ProductJobIntent,
  resourceReadiness: readonly ProductJobResourceReadiness[],
): Promise<boolean> {
  if (resourceReadiness.length === 0) {
    return true;
  }
  const unready: ProductJobResourceReadiness[] = await readUnreadyProductJobResources(
    runtime,
    intent.namespace,
    resourceReadiness,
  );
  if (unready.length === 0) {
    return true;
  }
  const expired: ProductJobResourceReadiness[] = readExpiredProductJobResources(unready, new Date());
  if (expired.length === 0) {
    return false;
  }
  await persistProductJobFailure(request, intent, 'resource-not-ready', new Error(expiredResourceMessage(expired)));
  return false;
}

/**
 * Connected resources that are not currently accepting connections, read straight from the API server
 * so a resource Pod replaced after the claim is seen as unavailable. This is one read round, never a
 * wait: the controller lane that would make a resource ready is the same lane that claims the Job.
 */
async function readUnreadyProductJobResources(
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

function readExpiredProductJobResources(
  unready: readonly ProductJobResourceReadiness[],
  now: Date,
): ProductJobResourceReadiness[] {
  return unready.filter(
    (resource: ProductJobResourceReadiness): boolean => Date.parse(resource.deadlineAt) <= now.getTime(),
  );
}

function expiredResourceMessage(expired: readonly ProductJobResourceReadiness[]): string {
  const names: string = expired.map((resource: ProductJobResourceReadiness): string => resource.resourceId).join(', ');
  return `The Job was not created: connected resources stayed unready past their declared readiness timeout: ${names}.`;
}

function resourceWorkloadIdentity(resourceId: string, namespace: string): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: kubeResourceName(resourceId), namespace },
  };
}
