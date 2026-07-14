import type { KubeObservation, KubeObservationEvent, KubeObservedManifest } from './kube-runtime.types';

export interface TerminalJob {
  exitCode: number;
  podName: string;
  podNames: string[];
  succeeded: boolean;
}

interface JobStatus {
  failed?: number | undefined;
  succeeded?: number | undefined;
}

interface PodStatus {
  containerStatuses?: { state?: { terminated?: { exitCode?: number | undefined } | undefined } | undefined }[];
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
  if ((status?.succeeded ?? 0) === 0 && (status?.failed ?? 0) === 0) {
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
  const pod: KubeObservedManifest | undefined = succeeded
    ? terminalPods.find((candidate: KubeObservedManifest): boolean => readPodExitCode(candidate) === 0)
    : terminalPods.at(-1);
  if (pod?.metadata?.name === undefined) {
    return null;
  }
  return {
    exitCode: readPodExitCode(pod) ?? 1,
    podName: pod.metadata.name,
    podNames: readTerminalPodNames(terminalPods),
    succeeded,
  };
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
