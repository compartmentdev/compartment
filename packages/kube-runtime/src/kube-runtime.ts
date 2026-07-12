import { CoreV1Api, KubeConfig, KubernetesObjectApi, PatchStrategy } from '@kubernetes/client-node';
import { createKubeObservation } from './kube-observation';
import { kubeFinalizedJobManifest, kubeJobManifest, waitForTerminalJob, type TerminalJob } from './kube-job';
import { kubeJobName } from './kube-naming';
import { createOrValidate } from './kube-provisioning-validation';
import type {
  ApplyBundle,
  KubeJobResult,
  KubePersistedJobResult,
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

interface TerminalJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
}

interface KubeHttpError extends Error {
  statusCode?: number | undefined;
}

type FinalizeJob = () => Promise<void>;

class CapturedKubeJobResult implements KubeJobResult {
  public readonly completedAt: Date;
  public readonly exitCode: number | null;
  public readonly jobName: string;
  public readonly logs: string;
  public readonly podName: string | null;
  public readonly status: 'succeeded' | 'failed' | 'timed-out';

  public constructor(
    result: TerminalJobResult,
    private readonly finalizeJob: FinalizeJob,
  ) {
    this.completedAt = result.completedAt;
    this.exitCode = result.exitCode;
    this.jobName = result.jobName;
    this.logs = result.logs;
    this.podName = result.podName;
    this.status = result.status;
  }

  public async finalize(): Promise<void> {
    await this.finalizeJob();
  }
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

  public async runJob(spec: KubeJobSpec, persistedResult?: KubePersistedJobResult): Promise<KubeJobResult> {
    const jobName: string = kubeJobName(spec.id);
    const labels: Record<string, string> = { ...spec.labels, 'compartment.dev/job-id': spec.id };
    const jobExists: boolean = await this.jobExists(spec.namespace, jobName);
    if (persistedResult !== undefined) {
      return this.buildCapturedJobResult(spec, jobName, labels, persistedResult, jobExists);
    }
    if (!jobExists) {
      try {
        await this.apply({ objects: [kubeJobManifest(spec, jobName, labels)] });
      } catch (error) {
        if (!(error instanceof Error && readHttpStatusCode(error) === 409)) throw error;
      }
    }
    const terminalResult: TerminalJobResult = await this.completeJob(spec, jobName);
    return this.buildCapturedJobResult(spec, jobName, labels, terminalResult, true);
  }

  private buildCapturedJobResult(
    spec: KubeJobSpec,
    jobName: string,
    labels: Record<string, string>,
    result: TerminalJobResult,
    jobExists: boolean,
  ): KubeJobResult {
    return new CapturedKubeJobResult(result, async (): Promise<void> => {
      if (!jobExists) return await Promise.resolve();
      if (result.status === 'timed-out') await this.deleteJob(spec.namespace, jobName);
      else await this.apply({ objects: [kubeFinalizedJobManifest(spec, jobName, labels)] });
    });
  }

  private async jobExists(namespace: string, jobName: string): Promise<boolean> {
    try {
      await this.objectApi.read({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName, namespace } });
      return true;
    } catch (error) {
      if (error instanceof Error && readHttpStatusCode(error) === 404) return false;
      throw error;
    }
  }

  private async completeJob(spec: KubeJobSpec, jobName: string): Promise<TerminalJobResult> {
    const deadline: JobDeadline = startJobDeadline(jobName, spec.timeoutMs);
    let observation: KubeObservation | null = null;
    try {
      observation = await createKubeObservation(
        this.kubeConfig,
        this.objectApi,
        jobObservationInput(spec),
        deadline.controller.signal,
      );
      try {
        return await this.readJobResult(spec, jobName, observation, deadline.expiresAt);
      } catch (error) {
        if (!deadline.controller.signal.aborted && !(error instanceof Error && isJobTimeoutError(error))) throw error;
        return await this.captureTimedOutJob(spec, jobName, observation);
      }
    } finally {
      clearTimeout(deadline.timer);
      if (observation !== null) {
        await observation.stop();
      }
    }
  }

  private async readJobResult(
    spec: KubeJobSpec,
    jobName: string,
    observation: KubeObservation,
    expiresAt: number,
  ): Promise<TerminalJobResult> {
    const remainingMs: number = Math.max(0, expiresAt - Date.now());
    const terminal: TerminalJob = await waitForTerminalJob(observation, jobName, remainingMs);
    const output: string = (
      await Promise.all(
        terminal.podNames.map(
          async (podName: string): Promise<string> =>
            await this.logs({ container: 'job', namespace: spec.namespace, podName }),
        ),
      )
    ).join('');
    return {
      completedAt: new Date(),
      exitCode: terminal.succeeded ? 0 : terminal.exitCode,
      jobName,
      logs: output,
      podName: terminal.podName,
      status: terminal.succeeded ? 'succeeded' : 'failed',
    };
  }

  private async captureTimedOutJob(
    spec: KubeJobSpec,
    jobName: string,
    observation: KubeObservation,
  ): Promise<TerminalJobResult> {
    const podNames: string[] = findJobPodNames(observation.cache, jobName);
    const output: string = (
      await Promise.all(
        podNames.map(async (podName: string): Promise<string> => await this.readAvailableLogs(spec.namespace, podName)),
      )
    ).join('');
    return {
      completedAt: new Date(),
      exitCode: null,
      jobName,
      logs: output,
      podName: podNames.at(-1) ?? null,
      status: 'timed-out',
    };
  }

  private async readAvailableLogs(namespace: string, podName: string): Promise<string> {
    try {
      return await this.logs({ container: 'job', namespace, podName });
    } catch {
      return '';
    }
  }

  private async deleteJob(namespace: string, jobName: string): Promise<void> {
    try {
      await this.objectApi.delete(
        { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName, namespace } },
        undefined,
        undefined,
        undefined,
        undefined,
        'Foreground',
      );
    } catch (error) {
      if (!(error instanceof Error && readHttpStatusCode(error) === 404)) throw error;
    }
  }
}

export function createKubeRuntimeFromEnvironment(env: NodeJS.ProcessEnv = process.env): KubeRuntime {
  const kubeConfig: KubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch (clusterError) {
    const kubeconfigPath: string | undefined = env.KUBECONFIG;
    if (kubeconfigPath === undefined || kubeconfigPath.trim() === '') throw clusterError;
    kubeConfig.loadFromFile(kubeconfigPath);
  }
  return new KubeRuntime(kubeConfig);
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

function readHttpStatusCode(error: Error): number | undefined {
  return (error as KubeHttpError).statusCode;
}

function isJobTimeoutError(error: Error): boolean {
  return error.message.includes('did not finish within');
}

function findJobPodNames(cache: ReadonlyMap<string, KubeManifest>, jobName: string): string[] {
  return [...cache.values()]
    .filter(
      (object: KubeManifest): boolean => object.kind === 'Pod' && object.metadata?.labels?.['job-name'] === jobName,
    )
    .map((pod: KubeManifest): string => pod.metadata?.name ?? '')
    .filter((podName: string): boolean => podName !== '')
    .sort((leftName: string, rightName: string): number => leftName.localeCompare(rightName));
}
