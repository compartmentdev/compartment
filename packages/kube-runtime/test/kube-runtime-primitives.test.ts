import { KubernetesObjectApi, PatchStrategy, type KubeConfig, type KubernetesObject } from '@kubernetes/client-node';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  KubeRuntime,
  kubeJobName,
  kubeNamespaceName,
  projectNamespaceProvisioningBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservation,
  type KubeObservationHealth,
  type ObserveLabels,
  type ProjectNamespaceProvisioningRow,
} from '../src';
import type { KubeObservationListener, KubeObservedManifest, KubeSecretEnvVariable } from '../src/kube-runtime.types';

const createObservationMock: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/kube-observation', (): object => ({ createKubeObservation: createObservationMock }));

interface JobManifestSpec {
  backoffLimit: number;
  template: {
    metadata: { annotations: Record<string, string> };
    spec: { automountServiceAccountToken: false; containers: JobContainerSpec[] };
  };
}

interface JobContainerSpec {
  env: KubeSecretEnvVariable[];
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
  public failCreateKind: string | null = null;
  public failDelete: boolean = false;
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

  public async delete(object: KubeManifest): Promise<KubernetesObject> {
    this.deletes.push(object);
    this.events.push(`delete:${object.kind}`);
    if (this.failDelete) {
      throw new Error('generated cleanup failure');
    }
    return await Promise.resolve(object);
  }

  public async read(object: KubeManifest): Promise<KubernetesObject> {
    this.events.push(`read:${object.kind}`);
    return await Promise.resolve(this.readOverrides.get(object.kind) ?? object);
  }

  public async patch(...input: KubePatchInvocation): Promise<KubernetesObject> {
    this.patches.push(input);
    this.events.push(`patch:${input[0].kind}`);
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
    objectApi.readOverrides.clear();
    objectApi.useStatusCodeConflict = false;
    coreApi.readNamespacedPodLog.mockClear();
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(objectApi as never);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('reuses a deterministic release Job, reads cached completion, and returns logs', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('release');
    const jobName: string = kubeJobName(spec.id);
    const stop: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
    createObservationMock.mockResolvedValue(terminalObservation(jobName, true, 0, stop));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    const manifest: KubeManifest = objectApi.patches[0]![0];
    expect(manifest.metadata?.name).toBe(jobName);
    expect((manifest.spec as JobManifestSpec).backoffLimit).toBe(0);
    expect((manifest.spec as JobManifestSpec).template.spec.containers[0]?.env).toEqual([
      { name: 'ALPHA', valueFrom: { secretKeyRef: { key: 'ALPHA', name: 'secret-job' } } },
      { name: 'ZETA', valueFrom: { secretKeyRef: { key: 'ZETA', name: 'secret-job' } } },
    ]);
    expect((manifest.spec as JobManifestSpec).template.spec.automountServiceAccountToken).toBe(false);
    expect((manifest.spec as JobManifestSpec).template.metadata.annotations['compartment.dev/secret-checksum']).toBe(
      'generated-checksum',
    );
    expect(objectApi.patches[0]?.slice(3)).toEqual(['compartment', false, PatchStrategy.ServerSideApply]);
    expect(coreApi.readNamespacedPodLog).toHaveBeenCalledWith({
      container: 'job',
      name: 'job-pod',
      namespace: spec.namespace,
    });
    expect(result).toMatchObject({ exitCode: 0, jobName, logs: 'done\n', podName: 'job-pod' });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('returns the cached failed container exit code and still stops observation', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec('operation');
    const jobName: string = kubeJobName(spec.id);
    const stop: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
    createObservationMock.mockResolvedValue(terminalObservation(jobName, false, 23, stop));
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(objectApi.patches[0]![0].spec).toMatchObject({ backoffLimit: 1 });
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
    expect(objectApi.deletes).toMatchObject([{ kind: 'ClusterRoleBinding' }]);
    expect(objectApi.events.at(-1)).toBe('delete:ClusterRoleBinding');
  });

  it('uses installation authority to remove bootstrap access after a partial create failure', async (): Promise<void> => {
    objectApi.failCreateKind = 'ServiceAccount';
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await expect(runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-failure')))).rejects.toThrow(
      'generated ServiceAccount failure',
    );
    expect(objectApi.events).toEqual(['create:Namespace', 'create:ServiceAccount', 'delete:ClusterRoleBinding']);
  });

  it('preserves provisioning and cleanup failures together', async (): Promise<void> => {
    objectApi.failCreateKind = 'ServiceAccount';
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
      { message: 'generated ServiceAccount failure' },
      { message: 'generated cleanup failure' },
    ]);
    expect(failure.cause).toMatchObject({ message: 'generated ServiceAccount failure' });
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
      metadata: { namespace, name: 'compartment-controller' },
      roleRef: { name: 'compartment-controller', kind: 'ClusterRole', apiGroup: 'rbac.authorization.k8s.io' },
      subjects: [{ namespace, name: 'compartment-controller', kind: 'ServiceAccount' }],
    });
    const runtime: KubeRuntime = new KubeRuntime(
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
      { makeApiClient: (): PrimitiveCoreApi => coreApi } as never,
    );
    await expect(
      runtime.apply(projectNamespaceProvisioningBundle(provisioningRow('prj-reordered'))),
    ).resolves.toHaveLength(7);
  });

  it('applies one timeout to informer startup and terminal observation', async (): Promise<void> => {
    vi.useFakeTimers();
    createObservationMock.mockImplementation(
      async (
        kubeConfig: KubeConfig,
        objectClient: KubernetesObjectApi,
        input: ObserveLabels,
        signal: AbortSignal,
      ): Promise<KubeObservation> => {
        void kubeConfig;
        void objectClient;
        void input;
        return await new Promise<KubeObservation>(
          (_resolve: (value: KubeObservation) => void, reject: (reason: Error) => void): void => {
            signal.addEventListener('abort', (): void => reject(signal.reason as Error), { once: true });
          },
        );
      },
    );
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): PrimitiveCoreApi => coreApi } as never);
    const pending: Promise<KubeJobResult> = runtime.runJob({ ...jobSpec('release'), timeoutMs: 100 });
    const rejection: Promise<void> = expect(pending).rejects.toThrow('did not finish within 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});

function jobSpec(jobClass: 'operation' | 'release'): KubeJobSpec {
  return {
    id: 'job-01jz',
    image: 'registry.example/release@sha256:abc',
    jobClass,
    env: { checksum: 'generated-checksum', keys: ['ZETA', 'ALPHA', 'ZETA'], secretName: 'secret-job' },
    labels: { 'compartment.dev/deployment-id': 'dep-01jz' },
    namespace: 'cpt-prj-01jz',
    timeoutMs: 1_000,
  };
}

function provisioningRow(namespaceId: string): ProjectNamespaceProvisioningRow {
  return {
    namespaceId,
    networkPolicy: {
      applicationPodLabels: { app: 'application' },
      applicationPort: 8080,
      edgeNamespaceId: 'edge-namespace',
      edgePodLabels: { app: 'caddy' },
      podCidr: ['10', '42', '0', '0/16'].join('.'),
      resourcePodLabels: { app: 'resource' },
      resourcePort: 5432,
      serviceCidr: ['10', '43', '0', '0/16'].join('.'),
    },
    projectId: namespaceId,
  };
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
