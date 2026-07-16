import { resourceReconcileLifecycleTimeoutMs } from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  readKubeRolloutObservation,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
} from '@compartment/kube-runtime';

interface ObservationReadResult<T> {
  error: Error | null;
  value: T | null;
}

export async function waitForFreshResourceDeployment(
  observation: KubeObservation,
  manifests: KubeManifest[],
): Promise<void> {
  const desired: KubeDeploymentManifest = requiredDeployment(manifests);
  const progressDeadlineSeconds: number | undefined = desired.spec?.progressDeadlineSeconds;
  const timeoutMs: number =
    progressDeadlineSeconds === undefined ? resourceReconcileLifecycleTimeoutMs : progressDeadlineSeconds * 1_000;
  const deadlineAt: Date = new Date(Date.now() + timeoutMs);
  await waitUntil(
    observation,
    (): true | null => readFreshResourceDeployment(findObservedManifest(observation, desired), desired, deadlineAt),
    timeoutMs,
  );
}

export async function waitUntil<T>(
  observation: KubeObservation,
  read: () => T | null,
  timeoutMs: number = resourceReconcileLifecycleTimeoutMs,
): Promise<T> {
  const initial: ObservationReadResult<T> = tryReadObservation(read);
  if (initial.error !== null) {
    throw initial.error;
  }
  if (initial.value !== null) {
    return initial.value;
  }
  return await subscribeUntil(observation, read, timeoutMs);
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

async function subscribeUntil<T>(observation: KubeObservation, read: () => T | null, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
    let unsubscribe: () => void = (): void => undefined;
    const finish: (result: ObservationReadResult<T>) => void = (result: ObservationReadResult<T>): void => {
      if (result.error === null && result.value === null) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      if (result.error === null) {
        resolve(result.value!);
      } else {
        reject(result.error);
      }
    };
    const check: () => void = (): void => finish(tryReadObservation(read));
    const timer: NodeJS.Timeout = setTimeout((): void => {
      unsubscribe();
      reject(new Error('Timed out waiting for Kubernetes resource lifecycle evidence.'));
    }, timeoutMs);
    unsubscribe = observation.onEvent(check);
    check();
  });
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
