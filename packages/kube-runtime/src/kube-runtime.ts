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
    const observation: KubeObservation = await this.observe(jobObservationInput(spec));
    try {
      const terminal: TerminalJob = await waitForTerminalJob(observation, jobName, spec.timeoutMs);
      const output: string = await this.logs({
        container: 'job',
        namespace: spec.namespace,
        podName: terminal.podName,
      });
      return {
        completedAt: new Date(),
        exitCode: terminal.succeeded ? 0 : terminal.exitCode,
        jobName,
        logs: output,
        podName: terminal.podName,
      };
    } finally {
      await observation.stop();
    }
  }
}

function jobObservationInput(spec: KubeJobSpec): ObserveLabels {
  return {
    labels: { 'compartment.dev/job-id': spec.id },
    namespace: spec.namespace,
    resources: ['jobs', 'pods'],
  };
}
