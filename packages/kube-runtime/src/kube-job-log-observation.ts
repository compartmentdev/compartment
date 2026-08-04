import type { KubeConfig, KubernetesObjectApi } from '@kubernetes/client-node';
import { createKubeObservation } from './kube-observation';
import type { KubeObservation, KubeObservedManifest } from './kube-runtime.types';
import type { KubeJobSpec } from './kube-job-spec.types';
import { findJobPodNames, jobObservationInput } from './kube-runtime-operations';
import type { JobContainerStatus, JobStatus, PodStatus } from './kube-job-log-stream.types';
import { jobStatusTerminal } from './kube-job-status';

export async function observeJob(
  kubeConfig: KubeConfig,
  objectApi: KubernetesObjectApi,
  spec: KubeJobSpec,
  jobName: string,
  signal: AbortSignal,
): Promise<KubeObservation> {
  return await createKubeObservation(kubeConfig, objectApi, jobObservationInput(spec, jobName), signal);
}

export async function waitForJobPod(
  observation: KubeObservation,
  jobName: string,
  followedPodNames: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<string | null> {
  throwIfJobLogAborted(signal, jobName);
  const cached: string | null | undefined = readNextJobPod(observation, jobName, followedPodNames);
  if (cached !== undefined) {
    return cached;
  }
  return await waitForJobPodEvent(observation, jobName, followedPodNames, signal);
}

async function waitForJobPodEvent(
  observation: KubeObservation,
  jobName: string,
  followedPodNames: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<string | null> {
  return await new Promise<string | null>(
    (resolve: (podName: string | null) => void, reject: (error: Error) => void): void => {
      subscribeForJobPod(observation, jobName, followedPodNames, signal, resolve, reject);
    },
  );
}

function subscribeForJobPod(
  observation: KubeObservation,
  jobName: string,
  followedPodNames: ReadonlySet<string>,
  signal: AbortSignal,
  resolve: (podName: string | null) => void,
  reject: (error: Error) => void,
): void {
  let unsubscribe: () => void = (): void => undefined;
  const abort: () => void = (): void => {
    signal.removeEventListener('abort', abort);
    unsubscribe();
    reject(jobLogAbortError(signal, jobName));
  };
  const resolveCurrent: () => void = (): void =>
    resolveObservedJobPod(observation, jobName, followedPodNames, signal, abort, unsubscribe, resolve);
  unsubscribe = observation.onEvent(resolveCurrent);
  signal.addEventListener('abort', abort, { once: true });
  resolveCurrent();
  if (signal.aborted) {
    abort();
  }
}

function resolveObservedJobPod(
  observation: KubeObservation,
  jobName: string,
  followedPodNames: ReadonlySet<string>,
  signal: AbortSignal,
  abort: () => void,
  unsubscribe: () => void,
  resolve: (podName: string | null) => void,
): void {
  const podName: string | null | undefined = readNextJobPod(observation, jobName, followedPodNames);
  if (podName !== undefined) {
    signal.removeEventListener('abort', abort);
    unsubscribe();
    resolve(podName);
  }
}

function readNextJobPod(
  observation: KubeObservation,
  jobName: string,
  followedPodNames: ReadonlySet<string>,
): string | null | undefined {
  const nextPodName: string | undefined = findJobPodNames(observation.cache, jobName).find(
    (podName: string): boolean => !followedPodNames.has(podName) && jobContainerStarted(observation, podName),
  );
  if (nextPodName !== undefined) {
    return nextPodName;
  }
  return jobTerminal(observation, jobName) ? null : undefined;
}

function jobTerminal(observation: KubeObservation, jobName: string): boolean {
  const job: KubeObservedManifest | undefined = [...observation.cache.values()].find(
    (object: KubeObservedManifest): boolean => object.kind === 'Job' && object.metadata?.name === jobName,
  );
  const status: JobStatus | undefined = job?.status;
  return jobStatusTerminal(status);
}

function jobContainerStarted(observation: KubeObservation, podName: string): boolean {
  const pod: KubeObservedManifest | undefined = [...observation.cache.values()].find(
    (object: KubeObservedManifest): boolean => object.kind === 'Pod' && object.metadata?.name === podName,
  );
  const status: PodStatus = pod?.status ?? {};
  const container: JobContainerStatus | undefined = status.containerStatuses?.find(
    (candidate: JobContainerStatus): boolean => candidate.name === 'job',
  );
  return container?.state?.running !== undefined || container?.state?.terminated !== undefined;
}

export function throwIfJobLogAborted(signal: AbortSignal, jobName: string): void {
  if (signal.aborted) {
    throw jobLogAbortError(signal, jobName);
  }
}

export function jobLogAbortError(signal: AbortSignal, jobName: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`Kubernetes Job ${jobName} log stream aborted.`);
}
