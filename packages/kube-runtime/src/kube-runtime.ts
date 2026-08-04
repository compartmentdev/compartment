import { CoreV1Api, KubernetesObjectApi, Log, Metrics, type KubeConfig } from '@kubernetes/client-node';
import { createKubeObservation } from './kube-observation';
import { CapturedKubeJobResult } from './kube-captured-job-result';
import { readKubePodMetrics } from './kube-pod-metrics';
import type { KubePodMetricCollection, ObservePodMetrics } from './kube-pod-metrics.types';
import { waitForTerminalJob, type TerminalJob } from './kube-job';
import { startJobLogReporter, type JobLogReporter } from './kube-job-log-reporter';
import { createOrJoinKubeJob } from './kube-job-reconciliation';
import {
  kubeFinalizedJobManifest,
  kubeJobIdentity,
  kubeJobSecretManifest,
  recoveredJobSpec,
} from './kube-job-projection';
import { kubeJobName } from './kube-naming';
import type { TerminalJobResult } from './kube-runtime-job-result.types';
import { createOrValidate } from './kube-provisioning-validation';
import {
  applyObject,
  deleteObjectIgnoringNotFound,
  deleteObjectsPreservingPrimary,
  findJobPodNames,
  requireCleanupObjectApi,
  isJobTimeoutError,
  jobObservationInput,
  readObjectIgnoringNotFound,
  startJobDeadline,
  type JobDeadline,
} from './kube-runtime-operations';
import type {
  ApplyBundle,
  KubeJobResult,
  KubePersistedJobResult,
  KubeJobSpec,
  KubeLogReference,
  KubeManifest,
  KubeObservation,
  KubeObservedManifest,
  ObserveLabels,
} from './kube-runtime.types';

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
    const cleanupObjectApi: KubernetesObjectApi | null = requireCleanupObjectApi(cleanup, this.cleanupObjectApi);
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

  public async observe(input: ObserveLabels): Promise<KubeObservation> {
    return await createKubeObservation(this.kubeConfig, this.objectApi, input);
  }

  public async read(object: KubeManifest): Promise<KubeObservedManifest | null> {
    return await readObjectIgnoringNotFound(this.objectApi, object);
  }

  public async delete(objects: KubeManifest[]): Promise<void> {
    await deleteObjectsPreservingPrimary(this.objectApi, objects, null);
  }

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection> {
    return await readKubePodMetrics(this.coreApi, new Metrics(this.kubeConfig), input);
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
    const labels: Record<string, string> = { ...spec.labels, 'compartment.dev/job-id': jobName };
    const observedJob: KubeObservedManifest | null = await this.read(kubeJobIdentity(spec, jobName));
    if (persistedResult !== undefined) {
      return this.captureJob(
        recoveredJobSpec(spec, observedJob),
        jobName,
        labels,
        persistedResult,
        observedJob !== null,
      );
    }
    const joinedJob: KubeObservedManifest | null = await createOrJoinKubeJob(this, spec, jobName, labels, observedJob);
    return this.captureJob(
      recoveredJobSpec(spec, joinedJob),
      jobName,
      labels,
      await this.completeJob(spec, jobName),
      true,
    );
  }

  private captureJob(
    spec: KubeJobSpec,
    jobName: string,
    labels: Record<string, string>,
    result: TerminalJobResult,
    jobExists: boolean,
  ): KubeJobResult {
    return new CapturedKubeJobResult(result, async (): Promise<void> => {
      if (!jobExists) {
        return await Promise.resolve();
      }
      if (result.status === 'timed-out' || spec.cleanupPolicy === 'delete') {
        await deleteObjectIgnoringNotFound(
          this.objectApi,
          { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName, namespace: spec.namespace } },
          'Foreground',
        );
      } else {
        await this.apply({ objects: [kubeFinalizedJobManifest(spec, jobName, labels)] });
      }
      await deleteObjectIgnoringNotFound(this.objectApi, kubeJobSecretManifest(spec, labels));
    });
  }

  private async completeJob(spec: KubeJobSpec, jobName: string): Promise<TerminalJobResult> {
    const deadline: JobDeadline = startJobDeadline(jobName, spec.timeoutMs);
    let observation: KubeObservation | null = null;
    try {
      observation = await createKubeObservation(
        this.kubeConfig,
        this.objectApi,
        jobObservationInput(spec, jobName),
        deadline.controller.signal,
      );
      try {
        return await this.readJobResult(spec, jobName, observation, deadline.expiresAt);
      } catch (error) {
        if (!deadline.controller.signal.aborted && !(error instanceof Error && isJobTimeoutError(error))) {
          throw error;
        }
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
    const logReporter: JobLogReporter | null = startJobLogReporter(
      new Log(this.kubeConfig),
      spec,
      observation,
      jobName,
    );
    let terminal: TerminalJob | null = null;
    try {
      terminal = await waitForTerminalJob(observation, jobName, Math.max(0, expiresAt - Date.now()));
    } finally {
      if (logReporter !== null) {
        await logReporter.stopAndFlush(terminal?.podNames ?? findJobPodNames(observation.cache, jobName));
      }
    }
    return await this.captureTerminalJobResult(spec, jobName, terminal);
  }

  private async captureTerminalJobResult(
    spec: KubeJobSpec,
    jobName: string,
    terminal: TerminalJob,
  ): Promise<TerminalJobResult> {
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
}
