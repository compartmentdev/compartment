import { CoreV1Api, KubernetesObjectApi, PatchStrategy, type KubeConfig } from '@kubernetes/client-node';
import { createKubeObservation } from './kube-observation';
import { kubeJobManifest, waitForTerminalJob, type TerminalJob } from './kube-job';
import { kubeJobName } from './kube-naming';
import type {
  ApplyBundle,
  KubeJobResult,
  KubeJobSpec,
  KubeLogReference,
  KubeManifest,
  KubeObservation,
  ObserveLabels,
} from './kube-runtime.types';

const fieldManager: string = 'compartment';

interface JobDeadline {
  controller: AbortController;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export class KubeRuntime {
  private readonly coreApi: CoreV1Api;
  private readonly objectApi: KubernetesObjectApi;

  public constructor(private readonly kubeConfig: KubeConfig) {
    this.coreApi = kubeConfig.makeApiClient(CoreV1Api);
    this.objectApi = KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  public async apply(bundle: ApplyBundle): Promise<KubeManifest[]> {
    const applied: KubeManifest[] = [];
    for (const object of bundle.objects) {
      const result: KubeManifest = await this.objectApi.patch(
        object,
        undefined,
        undefined,
        fieldManager,
        bundle.force ?? false,
        PatchStrategy.ServerSideApply,
      );
      applied.push(result);
    }
    return applied;
  }

  public async observe(input: ObserveLabels): Promise<KubeObservation> {
    return await createKubeObservation(this.kubeConfig, this.objectApi, input);
  }

  public async logs(reference: KubeLogReference): Promise<string> {
    return await this.coreApi.readNamespacedPodLog({
      name: reference.podName,
      namespace: reference.namespace,
      ...(reference.container === undefined ? {} : { container: reference.container }),
      ...(reference.tailLines === undefined ? {} : { tailLines: reference.tailLines }),
    });
  }

  public async runJob(spec: KubeJobSpec): Promise<KubeJobResult> {
    const jobName: string = kubeJobName(spec.id);
    const labels: Record<string, string> = { ...spec.labels, 'compartment.dev/job-id': spec.id };
    await this.apply({ objects: [kubeJobManifest(spec, jobName, labels)] });
    return await this.completeJob(spec, jobName);
  }

  private async completeJob(spec: KubeJobSpec, jobName: string): Promise<KubeJobResult> {
    const deadline: JobDeadline = startJobDeadline(jobName, spec.timeoutMs);
    let observation: KubeObservation | null = null;
    try {
      observation = await createKubeObservation(
        this.kubeConfig,
        this.objectApi,
        jobObservationInput(spec),
        deadline.controller.signal,
      );
      return await this.readJobResult(spec, jobName, observation, deadline.expiresAt);
    } finally {
      clearTimeout(deadline.timer);
      if (observation !== null) await observation.stop();
    }
  }

  private async readJobResult(
    spec: KubeJobSpec,
    jobName: string,
    observation: KubeObservation,
    expiresAt: number,
  ): Promise<KubeJobResult> {
    const remainingMs: number = Math.max(0, expiresAt - Date.now());
    const terminal: TerminalJob = await waitForTerminalJob(observation, jobName, remainingMs);
    const output: string = await this.logs({ container: 'job', namespace: spec.namespace, podName: terminal.podName });
    return {
      completedAt: new Date(),
      exitCode: terminal.succeeded ? 0 : terminal.exitCode,
      jobName,
      logs: output,
      podName: terminal.podName,
    };
  }
}

function startJobDeadline(jobName: string, timeoutMs: number): JobDeadline {
  const controller: AbortController = new AbortController();
  const expiresAt: number = Date.now() + timeoutMs;
  const timeoutError: Error = new Error(`Kubernetes Job ${jobName} did not finish within ${timeoutMs}ms.`);
  const timer: NodeJS.Timeout = setTimeout((): void => controller.abort(timeoutError), timeoutMs);
  return { controller, expiresAt, timer };
}

function jobObservationInput(spec: KubeJobSpec): ObserveLabels {
  return {
    labels: { 'compartment.dev/job-id': spec.id },
    namespace: spec.namespace,
    resources: ['jobs', 'pods'],
  };
}
