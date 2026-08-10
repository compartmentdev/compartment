import type { KubeObservation, KubeObservationEvent, KubeObservedManifest } from './kube-runtime.types';
import { jobStatusFailed } from './kube-job-status';

export interface TerminalJob {
  exitCode: number;
  /** Set when the Pod never reached its own container because an init container failed first. */
  initFailureMessage: string | null;
  podName: string;
  podNames: string[];
  succeeded: boolean;
}

interface JobStatus {
  conditions?: JobStatusCondition[] | undefined;
  failed?: number | undefined;
  succeeded?: number | undefined;
}

interface JobStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}

interface PodInitFailure {
  exitCode: number;
  message: string;
}

interface PodContainerStatus {
  state?: { terminated?: { exitCode?: number | undefined; message?: string | undefined } | undefined } | undefined;
}

interface PodStatus {
  containerStatuses?: PodContainerStatus[];
  initContainerStatuses?: PodContainerStatus[];
}

export async function waitForTerminalJob(
  observation: KubeObservation,
  jobName: string,
  timeoutMs: number,
): Promise<TerminalJob> {
  const cachedTerminal: TerminalJob | null = readTerminalJob(observation.cache, jobName);
  return cachedTerminal ?? (await waitForTerminalEvent(observation, jobName, timeoutMs));
}

async function waitForTerminalEvent(
  observation: KubeObservation,
  jobName: string,
  timeoutMs: number,
): Promise<TerminalJob> {
  return await new Promise<TerminalJob>(
    (resolve: (value: TerminalJob) => void, reject: (reason: Error) => void): void => {
      let unsubscribe: () => void = (): void => undefined;
      const timer: NodeJS.Timeout = setTimeout((): void => timeout(unsubscribe, reject, jobName, timeoutMs), timeoutMs);
      unsubscribe = observation.onEvent((event: KubeObservationEvent): void => {
        if (event.resource !== 'jobs' && event.resource !== 'pods') {
          return;
        }
        const terminal: TerminalJob | null = readTerminalJob(observation.cache, jobName);
        if (terminal === null) {
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve(terminal);
      });
    },
  );
}

function timeout(unsubscribe: () => void, reject: (reason: Error) => void, jobName: string, timeoutMs: number): void {
  unsubscribe();
  reject(new Error(`Kubernetes Job ${jobName} did not finish within ${timeoutMs}ms.`));
}

function readTerminalJob(cache: ReadonlyMap<string, KubeObservedManifest>, jobName: string): TerminalJob | null {
  const job: KubeObservedManifest | undefined = [...cache.values()].find(
    (object: KubeObservedManifest): boolean => object.kind === 'Job' && object.metadata?.name === jobName,
  );
  const status: JobStatus | undefined = job?.status;
  const failed: boolean = jobStatusFailed(status);
  if ((status?.succeeded ?? 0) === 0 && !failed) {
    return null;
  }
  return readTerminalPod(cache, jobName, (status?.succeeded ?? 0) > 0);
}

function readTerminalPod(
  cache: ReadonlyMap<string, KubeObservedManifest>,
  jobName: string,
  succeeded: boolean,
): TerminalJob | null {
  const pods: KubeObservedManifest[] = [...cache.values()].filter(
    (object: KubeObservedManifest): boolean =>
      object.kind === 'Pod' && object.metadata?.labels?.['job-name'] === jobName,
  );
  const terminalPods: KubeObservedManifest[] = pods.filter(
    (pod: KubeObservedManifest): boolean => readPodExitCode(pod) !== null,
  );
  const failedInitPods: KubeObservedManifest[] = succeeded
    ? []
    : pods.filter((pod: KubeObservedManifest): boolean => readPodInitFailure(pod) !== null);
  const pod: KubeObservedManifest | undefined = succeeded
    ? terminalPods.find((candidate: KubeObservedManifest): boolean => readPodExitCode(candidate) === 0)
    : (terminalPods.at(-1) ?? failedInitPods.at(-1));
  if (pod?.metadata?.name === undefined) {
    return null;
  }
  const initFailure: PodInitFailure | null = readPodInitFailure(pod);
  return {
    exitCode: readPodExitCode(pod) ?? initFailure?.exitCode ?? 1,
    initFailureMessage: readPodExitCode(pod) === null ? (initFailure?.message ?? null) : null,
    podName: pod.metadata.name,
    podNames: readTerminalPodNames(terminalPods),
    succeeded,
  };
}

/**
 * A Pod whose init container failed never runs its own container, so it reports no container exit code and its
 * logs cannot be read. Without this the Job is terminal in Kubernetes while the worker waits out the full Job
 * timeout and reports nothing about why. The failing container's termination message is the only account of it.
 */
function readPodInitFailure(pod: KubeObservedManifest): PodInitFailure | null {
  if (readPodExitCode(pod) !== null) {
    return null;
  }
  const podStatus: PodStatus | undefined = pod.status;
  for (const status of podStatus?.initContainerStatuses ?? []) {
    const exitCode: number | undefined = status.state?.terminated?.exitCode;
    if (exitCode !== undefined && exitCode !== 0) {
      return { exitCode, message: status.state?.terminated?.message ?? '' };
    }
  }
  return null;
}

function readTerminalPodNames(pods: KubeObservedManifest[]): string[] {
  return pods
    .map((candidate: KubeObservedManifest): string => candidate.metadata?.name ?? '')
    .filter((name: string): boolean => name !== '')
    .sort((leftName: string, rightName: string): number => leftName.localeCompare(rightName));
}

function readPodExitCode(pod: KubeObservedManifest): number | null {
  const podStatus: PodStatus | undefined = pod.status;
  return podStatus?.containerStatuses?.[0]?.state?.terminated?.exitCode ?? null;
}
