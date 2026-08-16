import { resourceReconcileLifecycleTimeoutMs } from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  readKubeRolloutObservation,
  readKubeContainerRunningStartedAt,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  readResourceReadinessTimeoutMs,
} from '@compartment/kube-runtime';

interface ObservationReadResult<T> {
  error: Error | null;
  value: T | null;
}

export async function waitForFreshResourceDeployment(
  observation: KubeObservation,
  manifests: KubeManifest[],
  infrastructureTimeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const desired: KubeDeploymentManifest = requiredDeployment(manifests);
  const timeoutMs: number = readResourceReadinessTimeoutMs(desired);
  const startedAt: Date = await waitUntil(
    observation,
    (): Date | null => readResourceContainerStartedAt(observation, desired),
    infrastructureTimeoutMs,
    signal,
  );
  const deadlineAt: Date = new Date(startedAt.getTime() + timeoutMs);
  const remainingMs: number = Math.max(0, deadlineAt.getTime() - Date.now());
  await waitUntil(
    observation,
    (): true | null => readFreshResourceDeployment(findObservedManifest(observation, desired), desired, deadlineAt),
    remainingMs,
    signal,
  );
}

function readResourceContainerStartedAt(observation: KubeObservation, desired: KubeDeploymentManifest): Date | null {
  const labels: Record<string, string> | undefined = desired.spec?.template.metadata.labels;
  const containerName: string | undefined = desired.spec?.template.spec.containers[0]?.name;
  if (labels === undefined || containerName === undefined) {
    throw new Error('Applied Kubernetes resource Deployment is missing Pod identity.');
  }
  return readKubeContainerRunningStartedAt(observation.cache.values(), labels, containerName);
}

export async function waitUntil<T>(
  observation: KubeObservation,
  read: () => T | null,
  timeoutMs: number = resourceReconcileLifecycleTimeoutMs,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted === true) {
    throw readAbortError(signal);
  }
  const initial: ObservationReadResult<T> = tryReadObservation(read);
  if (initial.error !== null) {
    throw initial.error;
  }
  if (initial.value !== null) {
    return initial.value;
  }
  return await subscribeUntil(observation, read, timeoutMs, signal);
}

export function assertResourceReconcileActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw readAbortError(signal);
  }
}

export function findObservedManifest(observation: KubeObservation, desired: KubeManifest): KubeObservedManifest | null {
  return (
    [...observation.cache.values()].find(
      (observed: KubeObservedManifest): boolean =>
        observed.kind === desired.kind && observed.metadata?.name === desired.metadata?.name,
    ) ?? null
  );
}

function readFreshResourceDeployment(
  observed: KubeObservedManifest | null,
  desired: KubeDeploymentManifest,
  deadlineAt: Date,
): true | null {
  const rollout: KubeRolloutObservation | null = readKubeRolloutObservation(observed, desired, deadlineAt);
  if (rollout === null) {
    return null;
  }
  const status: KubeRolloutStatus = calculateKubeRolloutStatus(rollout, new Date());
  if (status === 'progress-deadline-exceeded') {
    throw new Error('Kubernetes resource rollout exceeded its configured progress deadline.');
  }
  return status === 'ready' ? true : null;
}

function requiredDeployment(manifests: KubeManifest[]): KubeDeploymentManifest {
  const deployment: KubeManifest | undefined = manifests.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  if (deployment?.kind !== 'Deployment') {
    throw new Error('Resource reconcile Deployment manifest is missing.');
  }
  return deployment;
}

async function subscribeUntil<T>(
  observation: KubeObservation,
  read: () => T | null,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return await new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
    let unsubscribe: () => void = (): void => undefined;
    const finish: (result: ObservationReadResult<T>) => void = (result: ObservationReadResult<T>): void => {
      if (result.error === null && result.value === null) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (result.error === null) {
        resolve(result.value!);
      } else {
        reject(result.error);
      }
    };
    const check: () => void = (): void => finish(tryReadObservation(read));
    const abort: () => void = (): void => {
      if (signal !== undefined) {
        finish({ error: readAbortError(signal), value: null });
      }
    };
    const timer: NodeJS.Timeout = setTimeout(
      (): void =>
        finish({ error: new Error('Timed out waiting for Kubernetes resource lifecycle evidence.'), value: null }),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    unsubscribe = observation.onEvent(check);
    check();
  });
}

function readAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Resource reconcile observation was aborted.');
}

function tryReadObservation<T>(read: () => T | null): ObservationReadResult<T> {
  try {
    return { error: null, value: read() };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error('Kubernetes resource observation failed.'),
      value: null,
    };
  }
}
