import { KubernetesObjectApi, PatchStrategy, type KubernetesObject } from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  KubeRuntime,
  kubeJobName,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeObservation,
  type KubeObservationHealth,
} from '../src';
import type { KubeObservationListener } from '../src/kube-runtime.types';

const createObservationMock: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/kube-observation', (): object => ({ createKubeObservation: createObservationMock }));

interface JobManifestSpec {
  backoffLimit: number;
}

type KubePatchInvocation = [
  object: KubeManifest,
  pretty: string | undefined,
  dryRun: string | undefined,
  fieldManager: string,
  force: boolean,
  strategy: PatchStrategy,
];

class PrimitiveObjectApi {
  public readonly patches: KubePatchInvocation[] = [];

  public async patch(...input: KubePatchInvocation): Promise<KubernetesObject> {
    this.patches.push(input);
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
    vi.restoreAllMocks();
    objectApi.patches.length = 0;
    coreApi.readNamespacedPodLog.mockClear();
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(objectApi as never);
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
});

function jobSpec(jobClass: 'operation' | 'release'): KubeJobSpec {
  return {
    id: 'job-01jz',
    image: 'registry.example/release@sha256:abc',
    jobClass,
    labels: { 'compartment.dev/deployment-id': 'dep-01jz' },
    namespace: 'cpt-prj-01jz',
    timeoutMs: 1_000,
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
    public readonly cache: ReadonlyMap<string, KubeManifest>,
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
