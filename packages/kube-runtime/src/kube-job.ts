import type {
  KubeJobSpec,
  KubeJobManifest,
  KubeJobManifestSpec,
  KubeObservation,
  KubeObservationEvent,
  KubeObservedManifest,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
} from './kube-runtime.types';
import { compareKubeKey } from './kube-key-order';

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

export function kubeFinalizedJobManifest(
  spec: KubeJobSpec,
  jobName: string,
  labels: Record<string, string>,
): KubeJobManifest {
  const manifest: KubeJobManifest = kubeJobManifest(spec, jobName, labels);
  return { ...manifest, spec: { ...manifest.spec, ttlSecondsAfterFinished: 300 } };
}

export function kubeJobManifest(spec: KubeJobSpec, jobName: string, labels: Record<string, string>): KubeJobManifest {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { labels, name: jobName, namespace: spec.namespace },
    spec: jobSpec(spec, labels),
  };
}

export async function waitForTerminalJob(
  observation: KubeObservation,
  jobName: string,
  timeoutMs: number,
): Promise<TerminalJob> {
  const cachedTerminal: TerminalJob | null = readTerminalJob(observation.cache, jobName);
  return cachedTerminal ?? (await waitForTerminalEvent(observation, jobName, timeoutMs));
}

function jobSpec(spec: KubeJobSpec, labels: Record<string, string>): KubeJobManifestSpec {
  const podSpec: KubeProjectedPodSpec = {
    automountServiceAccountToken: false,
    containers: [jobContainer(spec)],
    restartPolicy: 'Never',
  };
  return {
    backoffLimit: spec.jobClass === 'release' ? 0 : 1,
    template: {
      metadata: { annotations: { 'compartment.dev/secret-checksum': spec.env.checksum }, labels },
      spec: podSpec,
    },
  };
}

function jobContainer(spec: KubeJobSpec): KubeProjectedContainer {
  const env: KubeSecretEnvVariable[] = [...new Set(spec.env.keys)].sort(compareKubeKey).map(
    (name: string): KubeSecretEnvVariable => ({
      name,
      valueFrom: { secretKeyRef: { key: name, name: spec.env.secretName } },
    }),
  );
  return {
    args: spec.args,
    command: spec.command,
    env,
    image: spec.image,
    name: 'job',
  };
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
    (object: KubeObservedManifest): boolean => object.kind === 'Pod' && object.metadata?.labels?.['job-name'] === jobName,
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
    podNames: terminalPods
      .map((candidate: KubeObservedManifest): string => candidate.metadata?.name ?? '')
      .filter((name: string): boolean => name !== '')
      .sort((leftName: string, rightName: string): number => leftName.localeCompare(rightName)),
    succeeded,
  };
}

function readPodExitCode(pod: KubeObservedManifest): number | null {
  const podStatus: PodStatus | undefined = pod.status;
  return podStatus?.containerStatuses?.[0]?.state?.terminated?.exitCode ?? null;
}
