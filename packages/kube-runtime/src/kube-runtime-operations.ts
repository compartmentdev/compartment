import { PatchStrategy, type KubernetesObjectApi } from '@kubernetes/client-node';
import type { KubeJobSpec, KubeManifest, KubeObservedManifest, ObserveLabels } from './kube-runtime.types';

const fieldManager: string = 'compartment';

export interface JobDeadline {
  controller: AbortController;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface KubeHttpError extends Error {
  statusCode?: number | undefined;
}

export async function applyObject(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
  force: boolean,
): Promise<KubeManifest> {
  return await objectApi.patch(object, undefined, undefined, fieldManager, force, PatchStrategy.ServerSideApply);
}

export async function deleteObjectsPreservingPrimary(
  objectApi: KubernetesObjectApi | null,
  objects: KubeManifest[],
  primaryError: Error | null,
): Promise<void> {
  try {
    await deleteObjects(objectApi, objects);
  } catch (cleanupError) {
    if (primaryError !== null) {
      throw new AggregateError(
        [primaryError, cleanupError as Error],
        'Kubernetes provisioning and bootstrap cleanup both failed.',
        { cause: primaryError },
      );
    }
    throw cleanupError;
  }
}

export function startJobDeadline(jobName: string, timeoutMs: number): JobDeadline {
  const controller: AbortController = new AbortController();
  const expiresAt: number = Date.now() + timeoutMs;
  const timeoutError: Error = new Error(`Kubernetes Job ${jobName} did not finish within ${timeoutMs}ms.`);
  const timer: NodeJS.Timeout = setTimeout((): void => controller.abort(timeoutError), timeoutMs);
  return { controller, expiresAt, timer };
}

export function jobObservationInput(spec: KubeJobSpec): ObserveLabels {
  return {
    labels: { 'compartment.dev/job-id': spec.id },
    namespace: spec.namespace,
    resources: ['jobs', 'pods'],
  };
}

export async function deleteObjectIgnoringNotFound(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
  propagationPolicy?: 'Foreground',
): Promise<void> {
  try {
    await objectApi.delete(object, undefined, undefined, undefined, undefined, propagationPolicy);
  } catch (error) {
    if (!(error instanceof Error && readHttpStatusCode(error) === 404)) throw error;
  }
}

export function readHttpStatusCode(error: Error): number | undefined {
  return (error as KubeHttpError).statusCode;
}

export function isJobTimeoutError(error: Error): boolean {
  return error.message.includes('did not finish within');
}

export function findJobPodNames(cache: ReadonlyMap<string, KubeObservedManifest>, jobName: string): string[] {
  return [...cache.values()]
    .filter(
      (object: KubeObservedManifest): boolean =>
        object.kind === 'Pod' && object.metadata?.labels?.['job-name'] === jobName,
    )
    .map((pod: KubeObservedManifest): string => pod.metadata?.name ?? '')
    .filter((podName: string): boolean => podName !== '')
    .sort((leftName: string, rightName: string): number => leftName.localeCompare(rightName));
}

async function deleteObjects(objectApi: KubernetesObjectApi | null, objects: KubeManifest[]): Promise<void> {
  if (objectApi === null) return;
  for (const object of objects) await objectApi.delete(object);
}
