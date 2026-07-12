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
  KubeManifestKind,
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
    try {
      return await this.applyObjects(bundle, cleanupObjectApi);
    } finally {
      await deleteObjects(cleanupObjectApi, cleanup);
    }
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

interface KubeApiError {
  code?: number | undefined;
}

interface KubeObjectHeaderMetadata {
  name: string;
  namespace?: string;
}

interface KubeObjectHeader {
  apiVersion: string;
  kind: KubeManifestKind;
  metadata: KubeObjectHeaderMetadata;
}

async function createOrValidate(
  objectApi: KubernetesObjectApi,
  reader: KubernetesObjectApi | null,
  object: KubeManifest,
): Promise<KubeManifest> {
  try {
    return await objectApi.create(object);
  } catch (error) {
    if ((error as KubeApiError).code !== 409 || reader === null) {
      throw error;
    }
    const existing: KubeManifest = await reader.read<KubeManifest>(objectHeader(object));
    validateExistingProvisioningObject(existing, object);
    return existing;
  }
}

function objectHeader(object: KubeManifest): KubeObjectHeader {
  const name: string | undefined = object.metadata?.name;
  const apiVersion: string | undefined = object.apiVersion;
  if (name === undefined || apiVersion === undefined) {
    throw new Error(`Kubernetes ${object.kind} requires an API version and name.`);
  }
  return {
    apiVersion,
    kind: object.kind,
    metadata: { name, ...(object.metadata?.namespace === undefined ? {} : { namespace: object.metadata.namespace }) },
  };
}

function validateExistingProvisioningObject(existing: KubeManifest, desired: KubeManifest): void {
  const sameIdentity: boolean =
    existing.kind === desired.kind &&
    existing.metadata?.name === desired.metadata?.name &&
    existing.metadata?.namespace === desired.metadata?.namespace;
  const sameProvisioningFields: boolean = hasSameProvisioningFields(existing, desired);
  if (!sameIdentity || !sameProvisioningFields) {
    throw new Error(`Existing Kubernetes ${desired.kind} does not match the provisioning contract.`);
  }
}

function hasSameProvisioningFields(existing: KubeManifest, desired: KubeManifest): boolean {
  if (desired.kind === 'Namespace') {
    return hasDesiredLabels(existing, desired);
  }
  if (desired.kind === 'ServiceAccount') {
    return existing.automountServiceAccountToken === false;
  }
  return (
    desired.kind === 'RoleBinding' &&
    JSON.stringify(existing.roleRef) === JSON.stringify(desired.roleRef) &&
    JSON.stringify(existing.subjects) === JSON.stringify(desired.subjects)
  );
}

function hasDesiredLabels(existing: KubeManifest, desired: KubeManifest): boolean {
  return Object.entries(desired.metadata?.labels ?? {}).every(
    ([key, value]: [string, string]): boolean => existing.metadata?.labels?.[key] === value,
  );
}

async function applyObject(
  objectApi: KubernetesObjectApi,
  object: KubeManifest,
  force: boolean,
): Promise<KubeManifest> {
  return await objectApi.patch(object, undefined, undefined, fieldManager, force, PatchStrategy.ServerSideApply);
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
