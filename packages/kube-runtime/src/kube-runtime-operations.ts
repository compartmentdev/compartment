import {
  PatchStrategy,
  type KubernetesObject,
  type KubernetesObjectApi,
  type V1DeleteOptions,
} from '@kubernetes/client-node';
import type { KubeJobSpec, KubeManifest, KubeObservedManifest, ObserveLabels } from './kube-runtime.types';

const fieldManager: string = 'compartment';

export interface JobDeadline {
  controller: AbortController;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface KubeHttpError extends Error {
  code?: number | undefined;
  statusCode?: number | undefined;
}

export function requireCleanupObjectApi(
  cleanup: KubeManifest[],
  objectApi: KubernetesObjectApi | null,
): KubernetesObjectApi | null {
  if (cleanup.length > 0 && objectApi === null) {
    throw new Error('Kubernetes provisioning cleanup requires a separate installation identity.');
  }
  return objectApi;
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

export function jobObservationInput(spec: KubeJobSpec, jobName: string): ObserveLabels {
  return {
    labels: { 'compartment.dev/job-id': jobName },
    namespace: spec.namespace,
    resources: ['jobs', 'pods'],
  };
}

async function deleteObjects(objectApi: KubernetesObjectApi | null, objects: KubeManifest[]): Promise<void> {
  if (objectApi === null) {
    return;
  }
  for (const object of objects) {
    await deleteObjectIgnoringNotFound(objectApi, object, object.kind === 'Namespace' ? 'Foreground' : undefined);
  }
}

export async function deleteObjectIgnoringNotFound(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
  propagationPolicy?: 'Foreground',
): Promise<void> {
  try {
    const uid: string | undefined = object.metadata?.uid;
    const resourceVersion: string | undefined = object.metadata?.resourceVersion;
    const options: V1DeleteOptions | undefined =
      uid === undefined && resourceVersion === undefined
        ? undefined
        : {
            preconditions: {
              ...(resourceVersion === undefined ? {} : { resourceVersion }),
              ...(uid === undefined ? {} : { uid }),
            },
          };
    await objectApi.delete(object, undefined, undefined, undefined, undefined, propagationPolicy, options);
  } catch (error) {
    if (!(error instanceof Error && readHttpStatusCode(error) === 404)) {
      throw error;
    }
  }
}

export async function readObjectIgnoringNotFound(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
): Promise<KubeObservedManifest | null> {
  try {
    const observed: KubernetesObject = await objectApi.read(object as never);
    return observed as KubeObservedManifest;
  } catch (error) {
    if (error instanceof Error && readHttpStatusCode(error) === 404) {
      return null;
    }
    throw error;
  }
}

export function readHttpStatusCode(error: Error): number | undefined {
  const httpError: KubeHttpError = error;
  return httpError.statusCode ?? httpError.code;
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
