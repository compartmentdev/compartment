import { CoreV1Api, KubernetesObjectApi, PatchStrategy, type KubeConfig } from '@kubernetes/client-node';
import { createKubeObservation } from './kube-observation';
import { kubeJobManifest, waitForTerminalJob, type TerminalJob } from './kube-job';
import { kubeJobName } from './kube-naming';
import { createOrValidate } from './kube-provisioning-validation';
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
  private readonly cleanupObjectApi: KubernetesObjectApi | null;
  private readonly coreApi: CoreV1Api;
  private readonly objectApi: KubernetesObjectApi;

  public constructor(
    private readonly kubeConfig: KubeConfig,
    cleanupKubeConfig?: KubeConfig,
  ) {
    this.coreApi = kubeConfig.makeApiClient(CoreV1Api);
    this.objectApi = KubernetesObjectApi.makeApiClient(kubeConfig);
    this.cleanupObjectApi =
      cleanupKubeConfig === undefined ? null : KubernetesObjectApi.makeApiClient(cleanupKubeConfig);
  }

  public async apply(bundle: ApplyBundle): Promise<KubeManifest[]> {
    const cleanup: KubeManifest[] = bundle.deleteAfterApply ?? [];
    const cleanupObjectApi: KubernetesObjectApi | null = this.requiredCleanupApi(cleanup);
    let applied: KubeManifest[] = [];
    let primaryError: Error | null = null;
    try {
      applied = await this.applyObjects(bundle, cleanupObjectApi);
    } catch (error) {
      primaryError = error as Error;
    }
    await deleteObjectsPreservingPrimary(cleanupObjectApi, cleanup, primaryError);
    if (primaryError !== null) {
      throw primaryError;
    }
    return applied;
  }

  private async applyObjects(bundle: ApplyBundle, reader: KubernetesObjectApi | null): Promise<KubeManifest[]> {
    const applied: KubeManifest[] = [];
    for (const object of bundle.createBeforeApply ?? []) {
      applied.push(await createOrValidate(this.objectApi, reader, object));
    }
    for (const object of bundle.objects) {
      applied.push(await applyObject(this.objectApi, object, bundle.force ?? false));
    }
    return applied;
  }

  private requiredCleanupApi(cleanup: KubeManifest[]): KubernetesObjectApi | null {
    if (cleanup.length > 0 && this.cleanupObjectApi === null) {
      throw new Error('Kubernetes provisioning cleanup requires a separate installation identity.');
    }
    return this.cleanupObjectApi;
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

async function applyObject(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
  force: boolean,
): Promise<KubeManifest> {
  return await objectApi.patch(object, undefined, undefined, fieldManager, force, PatchStrategy.ServerSideApply);
}

async function deleteObjectsPreservingPrimary(
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

async function deleteObjects(objectApi: KubernetesObjectApi | null, objects: KubeManifest[]): Promise<void> {
  if (objectApi === null) {
    return;
  }
  for (const object of objects) {
    await objectApi.delete(object);
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
