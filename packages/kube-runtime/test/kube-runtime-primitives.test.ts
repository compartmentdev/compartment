import { KubernetesObjectApi, type KubernetesObject, type PatchStrategy } from '@kubernetes/client-node';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  KubeRuntime,
  kubeNamespaceName,
  projectNamespaceProvisioningBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservation,
  type ProjectNamespaceProvisioningRow,
} from '../src';
import { kubeJobName, kubeSecretName } from '../src/kube-naming';
import type {
  KubeObservationHealth,
  KubeObservationListener,
  KubeObservedManifest,
  KubeSecretEnvVariable,
} from '../src/kube-runtime.types';
import type { KubePodVolume } from '../src/kube-volume.types';

const createObservationMock: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/kube-observation', (): object => ({ createKubeObservation: createObservationMock }));

interface JobManifestSpec {
  activeDeadlineSeconds: number;
  backoffLimit: number;
  template: {
    metadata: { annotations: Record<string, string> };
    spec: {
      automountServiceAccountToken: false;
      containers: JobContainerSpec[];
      imagePullSecrets?: { name: string }[] | undefined;
      securityContext?: object | undefined;
      serviceAccountName?: string | undefined;
      volumes: KubePodVolume[];
    };
  };
}

interface JobContainerSpec {
  env: KubeSecretEnvVariable[];
  securityContext?: object | undefined;
}

type KubePatchInvocation = [
  object: KubeManifest,
  pretty: string | undefined,
  dryRun: string | undefined,
  fieldManager: string,
  force: boolean,
  strategy: PatchStrategy,
];

class KubeConflictError extends Error {
  public readonly code: number = 409;
}

class KubeStatusCodeConflictError extends Error {
  public readonly statusCode: number = 409;
}

class PrimitiveObjectApi {
  public readonly conflicts: Set<string> = new Set<string>();
  public readonly deletes: KubeManifest[] = [];
  public readonly events: string[] = [];
  public readonly patches: KubePatchInvocation[] = [];
  public readonly readOverrides: Map<string, KubeManifest> = new Map<string, KubeManifest>();
  public deleteError: Error | null = null;
  public failCreateKind: string | null = null;
  public failDelete: boolean = false;
  public jobExists: boolean = false;
  public patchError: Error | null = null;
  public patchErrorKind: string | null = null;
  public readError: Error | null = null;
  public useStatusCodeConflict: boolean = false;

  public async create(object: KubeManifest): Promise<KubernetesObject> {
    this.events.push(`create:${object.kind}`);
    if (object.kind === this.failCreateKind) {
      throw new Error(`generated ${object.kind} failure`);
    }
    if (this.conflicts.has(object.kind)) {
      if (!this.readOverrides.has(object.kind)) {
        this.readOverrides.set(object.kind, object);
      }
      throw this.useStatusCodeConflict
        ? new KubeStatusCodeConflictError('generated existing object')
        : new KubeConflictError('generated existing object');
    }
    return await Promise.resolve(object);
  }

  public readonly delete: Mock = vi.fn(async (object: KubeManifest): Promise<KubernetesObject> => {
    this.deletes.push(object);
    this.events.push(`delete:${object.kind}`);
    if (this.failDelete) {
      throw new Error('generated cleanup failure');
    }
    if (this.deleteError !== null) {
      throw this.deleteError;
    }
    return await Promise.resolve(object);
  });

  public async read(object: KubeManifest): Promise<KubernetesObject> {
    this.events.push(`read:${object.kind}`);
    if (this.readError !== null) {
      throw this.readError;
    }
    if (object.kind === 'Job' && !this.jobExists) {
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    }
    return await Promise.resolve(this.readOverrides.get(object.kind) ?? object);
  }

  public async patch(...input: KubePatchInvocation): Promise<KubernetesObject> {
    this.patches.push(input);
    this.events.push(`patch:${input[0].kind}`);
    if (this.patchError !== null && input[0].kind === this.patchErrorKind) {
      const error: Error = this.patchError;
      this.patchError = null;
      throw error;
    }
    return await Promise.resolve(input[0]);
  }
}

class PrimitiveCoreApi {
  public readonly readNamespacedPodLog: Mock = vi.fn(async (): Promise<string> => await Promise.resolve('done\n'));
}

describe('KubeRuntime Job primitive', (): void => {
  const objectApi: PrimitiveObjectApi = new PrimitiveObjectApi();
  const coreApi: PrimitiveCoreApi = new PrimitiveCoreApi();

  beforeEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    objectApi.patches.length = 0;
    objectApi.deletes.length = 0;
    objectApi.events.length = 0;
    objectApi.conflicts.clear();
    objectApi.failCreateKind = null;
    objectApi.failDelete = false;
    objectApi.deleteError = null;
    objectApi.readOverrides.clear();
    objectApi.useStatusCodeConflict = false;
    objectApi.jobExists = false;
    objectApi.patchError = null;
    objectApi.patchErrorKind = null;
    objectApi.readError = null;
    objectApi.delete.mockClear();
    coreApi.readNamespacedPodLog.mockClear();
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(objectApi as never);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('reads an observed object and treats a missing object as absent', async (): Promise<void> => {
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const deployment: KubeManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'app-1', namespace: 'project-1' },
    };

    await expect(runtime.read(deployment)).resolves.toEqual(deployment);
    objectApi.readError = Object.assign(new Error('not found'), { statusCode: 404 });
    await expect(runtime.read(deployment)).resolves.toBeNull();
    objectApi.readError = Object.assign(new Error('forbidden'), { statusCode: 403 });
    await expect(runtime.read(deployment)).rejects.toThrow('forbidden');
  });

  it('creates a deterministic release Job, reads cached completion, and finalizes TTL after capture', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('release');
    const jobName: string = kubeJobName(spec.id);
    const stop: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, stop));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);
    await result.finalize();

    const manifest: KubeManifest = objectApi.patches.find(
      ([object]: KubePatchInvocation): boolean => object.kind === 'Job',
    )![0];
    expect(manifest.metadata?.name).toBe(jobName);
    expect((manifest.spec as JobManifestSpec).backoffLimit).toBe(0);
    expect((manifest.spec as JobManifestSpec).activeDeadlineSeconds).toBe(1);
    expect((manifest.spec as JobManifestSpec).template.spec.containers[0]?.env).toEqual([
      { name: 'ALPHA', valueFrom: { secretKeyRef: { key: 'ALPHA', name: kubeSecretName(spec.id) } } },
      { name: 'ZETA', valueFrom: { secretKeyRef: { key: 'ZETA', name: kubeSecretName(spec.id) } } },
    ]);
    expect((manifest.spec as JobManifestSpec).template.spec.automountServiceAccountToken).toBe(false);
    expect((manifest.spec as JobManifestSpec).template.spec.imagePullSecrets).toEqual([
      { name: kubeSecretName(spec.imagePullSecretId ?? '') },
    ]);
    expect((manifest.spec as JobManifestSpec).template.metadata.annotations['compartment.dev/secret-checksum']).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result).toMatchObject({ exitCode: 0, jobName, logs: 'done\n', podName: 'job-pod', status: 'succeeded' });
    expect(objectApi.patches.at(-1)![0].spec).toMatchObject({ ttlSecondsAfterFinished: 300 });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('projects long logical Job IDs into Kubernetes-safe identity labels', async (): Promise<void> => {
    const spec: KubeJobSpec = {
      ...jobSpec('operation'),
      id: 'resource-operation-op_b7ab86af4420406486b1b81f118d0b4c-artifact-verify',
    };
    const jobName: string = kubeJobName(spec.id);
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, vi.fn()));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    await runtime.runJob(spec);

    const createdObjects: KubeManifest[] = objectApi.patches.map(
      ([object]: KubePatchInvocation): KubeManifest => object,
    );
    expect(createdObjects).toHaveLength(2);
    expect(
      createdObjects.map(
        (object: KubeManifest): string | undefined => object.metadata?.labels?.['compartment.dev/job-id'],
      ),
    ).toEqual([jobName, jobName]);
    expect(jobName.length).toBeLessThanOrEqual(63);
    expect(createObservationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ labels: { 'compartment.dev/job-id': jobName } }),
      expect.any(AbortSignal),
    );
  });

  it('bounds bootstrap Job execution and mounts only an expiring projected credential', async (): Promise<void> => {
    const spec: KubeJobSpec = {
      ...jobSpec('operation'),
      securityProfile: 'restricted',
      serviceAccountName: 'compartment-project-bootstrap',
      serviceAccountTokenExpirationSeconds: 600,
      timeoutMs: 300_000,
    };
    const jobName: string = kubeJobName(spec.id);
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, vi.fn()));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    await runtime.runJob(spec);

    const manifest: KubeManifest = objectApi.patches.find(
      ([object]: KubePatchInvocation): boolean => object.kind === 'Job',
    )![0];
    const projectedSpec: JobManifestSpec = manifest.spec as JobManifestSpec;
    expect(projectedSpec.activeDeadlineSeconds).toBe(300);
    expect(projectedSpec.template.spec.securityContext).toEqual({
      runAsGroup: 10_001,
      runAsNonRoot: true,
      runAsUser: 10_001,
      seccompProfile: { type: 'RuntimeDefault' },
    });
    expect(projectedSpec.template.spec.containers[0]?.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
    });
    expect(projectedSpec.template.spec.serviceAccountName).toBe('compartment-project-bootstrap');
    expect(projectedSpec.template.spec.volumes[0]?.projected?.sources[0]).toMatchObject({
      serviceAccountToken: { expirationSeconds: 600, path: 'token' },
    });
  });

  it('joins an existing deterministic Job without applying another Job', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('release');
    const jobName: string = kubeJobName(spec.id);
    objectApi.jobExists = true;
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, vi.fn()));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(result.status).toBe('succeeded');
    expect(objectApi.patches).toHaveLength(0);
  });

  it('joins after a concurrent deterministic-name collision instead of replacing the Job', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('release');
    const jobName: string = kubeJobName(spec.id);
    objectApi.patchError = Object.assign(new Error('already exists'), { statusCode: 409 });
    objectApi.patchErrorKind = 'Job';
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, vi.fn()));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(result).toMatchObject({ jobName, status: 'succeeded' });
    expect(objectApi.patches.filter(([object]: KubePatchInvocation): boolean => object.kind === 'Job')).toHaveLength(1);
  });

  it('rejoins the same Job after the worker is killed between creation and terminal observation', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('release');
    const jobName: string = kubeJobName(spec.id);
    createObservationMock.mockRejectedValueOnce(new Error('worker killed after create'));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    await expect(runtime.runJob(spec)).rejects.toThrow('worker killed after create');
    objectApi.jobExists = true;
    createObservationMock.mockResolvedValueOnce(terminalObservation(jobName, true, 0, vi.fn()));
    const recovered: KubeJobResult = await runtime.runJob(spec);

    expect(recovered).toMatchObject({ jobName, logs: 'done\n', status: 'succeeded' });
    expect(objectApi.patches.filter(([object]: KubePatchInvocation): boolean => object.kind === 'Job')).toHaveLength(1);
  });

  it('returns the cached failed container exit code and still stops observation', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('operation');
    const jobName: string = kubeJobName(spec.id);
    const stop: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
    createObservationMock.mockResolvedValue(terminalObservation(jobName, false, 23, stop));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(objectApi.patches.at(-1)![0].spec).toMatchObject({ backoffLimit: 1 });
    expect(result.exitCode).toBe(23);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('removes bootstrap authority after applying the namespace-local controller binding', async (): Promise<void> => {
    objectApi.conflicts.add('Namespace');
    objectApi.useStatusCodeConflict = true;
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-01jz')));
    expect(objectApi.deletes).toMatchObject([{ kind: 'RoleBinding' }, { kind: 'ClusterRoleBinding' }]);
    expect(objectApi.events.at(-1)).toBe('delete:ClusterRoleBinding');
  });

  it('treats already-removed bootstrap cleanup objects as converged', async (): Promise<void> => {
    objectApi.deleteError = Object.assign(new Error('not found'), { code: 404 });
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );

    await runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-retry')));
    expect(objectApi.deletes).toMatchObject([{ kind: 'RoleBinding' }, { kind: 'ClusterRoleBinding' }]);
  });

  it('passes manifest UID and resourceVersion as atomic Kubernetes delete preconditions', async (): Promise<void> => {
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const claim: KubeManifest = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: 'resource-data',
        namespace: 'cpt-project',
        resourceVersion: 'resource-version-7',
        uid: 'uid-original',
      },
    };
    objectApi.deleteError = Object.assign(new Error('UID precondition failed'), { statusCode: 409 });

    await expect(runtime.delete([claim])).rejects.toThrow('UID precondition failed');

    expect(objectApi.delete).toHaveBeenCalledWith(claim, undefined, undefined, undefined, undefined, undefined, {
      preconditions: { resourceVersion: 'resource-version-7', uid: 'uid-original' },
    });
  });

  it('uses installation authority to remove bootstrap access after a partial create failure', async (): Promise<void> => {
    objectApi.failCreateKind = 'RoleBinding';
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await expect(runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-failure')))).rejects.toThrow(
      'generated RoleBinding failure',
    );
    expect(objectApi.events).toEqual([
      'create:Namespace',
      'create:RoleBinding',
      'delete:RoleBinding',
      'delete:ClusterRoleBinding',
    ]);
  });

  it('preserves provisioning and cleanup failures together', async (): Promise<void> => {
    objectApi.failCreateKind = 'RoleBinding';
    objectApi.failDelete = true;
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    let failure: AggregateError | null = null;
    try {
      await runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-dual-failure')));
    } catch (error) {
      failure = error as AggregateError;
    }
    if (failure === null) {
      throw new Error('Expected provisioning and cleanup to fail.');
    }
    expect(failure.errors).toMatchObject([
      { message: 'generated RoleBinding failure' },
      { message: 'generated cleanup failure' },
    ]);
    expect(failure.cause).toMatchObject({ message: 'generated RoleBinding failure' });
  });

  it('rejects a conflicting RoleBinding that does not grant the canonical controller role', async (): Promise<void> => {
    objectApi.conflicts.add('RoleBinding');
    objectApi.readOverrides.set('RoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: 'compartment-controller', namespace: kubeNamespaceName('prj-conflict') },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'wrong-role' },
      subjects: [
        { kind: 'ServiceAccount', name: 'compartment-controller', namespace: kubeNamespaceName('prj-conflict') },
      ],
    });
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await expect(runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-conflict')))).rejects.toThrow(
      'does not match the provisioning contract',
    );
    expect(objectApi.events.at(-1)).toBe('delete:ClusterRoleBinding');
  });

  it('accepts a semantically identical RoleBinding regardless of object key order', async (): Promise<void> => {
    const namespace: string = kubeNamespaceName('prj-reordered');
    objectApi.conflicts.add('RoleBinding');
    objectApi.readOverrides.set('RoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { namespace, name: 'compartment-project-bootstrap' },
      roleRef: { name: 'compartment-controller', kind: 'ClusterRole', apiGroup: 'rbac.authorization.k8s.io' },
      subjects: [
        { namespace: 'compartment', name: 'compartment-project-bootstrap', kind: 'ServiceAccount' },
        { namespace: 'compartment', name: 'compartment-worker', kind: 'ServiceAccount' },
      ],
    });
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await expect(
      runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-reordered'))),
    ).resolves.toHaveLength(8);
  });

  it('captures every resource-operation attempt and selects the successful terminal Pod', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('operation');
    const jobName: string = kubeJobName(spec.id);
    createObservationMock.mockResolvedValue(retriedTerminalObservation(jobName));
    coreApi.readNamespacedPodLog.mockImplementation(async ({ name }: { name: string }): Promise<string> => {
      return await Promise.resolve(name === 'job-pod-1' ? 'failed attempt\n' : 'successful attempt\n');
    });
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(result).toMatchObject({
      exitCode: 0,
      logs: 'failed attempt\nsuccessful attempt\n',
      podName: 'job-pod-2',
      status: 'succeeded',
    });
  });

  it('deletes a timed-out Job and returns captured partial logs', async (): Promise<void> => {
    vi.useFakeTimers();
    const jobName: string = kubeJobName('job-01jz');
    createObservationMock.mockResolvedValue(nonTerminalObservation(jobName));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const pending: Promise<KubeJobResult> = runtime.runJob({ ...jobSpec('release'), timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result: KubeJobResult = await pending;

    expect(result).toMatchObject({ exitCode: null, logs: 'done\n', podName: 'job-pod', status: 'timed-out' });
    expect(objectApi.delete).not.toHaveBeenCalled();
    await result.finalize();
    expect(objectApi.delete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Job' }),
      undefined,
      undefined,
      undefined,
      undefined,
      'Foreground',
      undefined,
    );
  });

  it('captures a timeout before Pod creation without inventing a Pod identity', async (): Promise<void> => {
    vi.useFakeTimers();
    createObservationMock.mockResolvedValue(new TerminalObservation(new Map(), vi.fn()));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const pending: Promise<KubeJobResult> = runtime.runJob({ ...jobSpec('release'), timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toMatchObject({ logs: '', podName: null, status: 'timed-out' });
  });

  it('treats missing timeout cleanup as converged and propagates other deletion failures', async (): Promise<void> => {
    vi.useFakeTimers();
    const jobName: string = kubeJobName('job-01jz');
    createObservationMock.mockResolvedValue(nonTerminalObservation(jobName));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const missingPending: Promise<KubeJobResult> = runtime.runJob({ ...jobSpec('release'), timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const missingResult: KubeJobResult = await missingPending;
    objectApi.deleteError = Object.assign(new Error('not found'), { statusCode: 404 });
    await expect(missingResult.finalize()).resolves.toBeUndefined();

    objectApi.jobExists = true;
    const failingPending: Promise<KubeJobResult> = runtime.runJob({ ...jobSpec('release'), timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const failingResult: KubeJobResult = await failingPending;
    objectApi.deleteError = new Error('cleanup failed');
    await expect(failingResult.finalize()).rejects.toThrow('cleanup failed');
  });
});

function jobSpec(jobClass: 'operation' | 'release'): KubeJobSpec {
  return {
    id: 'job-01jz',
    image: 'registry.example/release@sha256:abc',
    ...(jobClass === 'release' ? { imagePullSecretId: 'pull-01jz' } : {}),
    jobClass,
    env: { ZETA: 'z', ALPHA: 'a' },
    labels: { 'compartment.dev/deployment-id': 'dep-01jz' },
    namespace: 'cpt-prj-01jz',
    timeoutMs: 1_000,
  };
}

function provisioningRow(namespaceId: string): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: { name: 'compartment-project-bootstrap', namespace: 'compartment' },
    namespaceId,
    networkPolicy: {
      applicationPodLabels: { app: 'application' },
      applicationPort: 8080,
      edgeNamespaceName: 'edge-namespace',
      edgePodLabels: { app: 'caddy' },
      podCidr: ['10', '42', '0', '0/16'].join('.'),
      resourcePodLabels: { app: 'resource' },
      resourcePort: 5432,
      serviceCidr: ['10', '43', '0', '0/16'].join('.'),
    },
    projectId: namespaceId,
    registryPullCredentials: {
      dockerConfigJson: '{"auths":{"registry.example":{"auth":"generated"}}}',
      secretId: `pull-${namespaceId}`,
    },
    workerServiceAccount: { name: 'compartment-worker', namespace: 'compartment' },
  };
}

function nonTerminalObservation(jobName: string): KubeObservation {
  return new TerminalObservation(
    new Map([
      [
        'pods/ns/job-pod',
        { apiVersion: 'v1', kind: 'Pod', metadata: { labels: { 'job-name': jobName }, name: 'job-pod' } },
      ],
    ]),
    vi.fn(),
  );
}

function retriedTerminalObservation(jobName: string): KubeObservation {
  return new TerminalObservation(
    new Map([
      ['jobs/ns/job', { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName }, status: { succeeded: 1 } }],
      [
        'pods/ns/job-pod-1',
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { labels: { 'job-name': jobName }, name: 'job-pod-1' },
          status: { containerStatuses: [{ state: { terminated: { exitCode: 17 } } }] },
        },
      ],
      [
        'pods/ns/job-pod-2',
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { labels: { 'job-name': jobName }, name: 'job-pod-2' },
          status: { containerStatuses: [{ state: { terminated: { exitCode: 0 } } }] },
        },
      ],
    ]),
    vi.fn(),
  );
}

function terminalObservation(jobName: string, succeeded: boolean, exitCode: number, stop: Mock): KubeObservation {
  return new TerminalObservation(
    new Map([
      [
        'jobs/ns/job',
        {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: { name: jobName },
          status: { [succeeded ? 'succeeded' : 'failed']: 1 },
        },
      ],
      [
        'pods/ns/job-pod',
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { labels: { 'job-name': jobName }, name: 'job-pod' },
          status: { containerStatuses: [{ state: { terminated: { exitCode } } }] },
        },
      ],
    ]),
    stop,
  );
}

class TerminalObservation implements KubeObservation {
  public constructor(
    public readonly cache: ReadonlyMap<string, KubeObservedManifest>,
    private readonly stopMock: Mock,
  ) {}

  public health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: null, lastErrorAt: null };
  }

  public onEvent(listener: KubeObservationListener): () => void {
    void listener;
    return (): void => undefined;
  }

  public async stop(): Promise<void> {
    await this.stopMock();
  }
}
