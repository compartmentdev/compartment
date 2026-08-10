import { KubernetesObjectApi } from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { waitForTerminalJob } from '../src/kube-job';
import type { TerminalJob } from '../src/kube-job.types';
import { kubeJobName } from '../src/kube-naming';
import type { ObservedPodStatus, StubCoreApi } from './kube-job-gate-failure.test.types';
import { KubeRuntime } from '../src/kube-runtime';
import type {
  KubeJobResult,
  KubeJobSpec,
  KubeManifest,
  KubeObservation,
  KubeObservationHealth,
  KubeObservedManifest,
} from '../src/kube-runtime.types';

const createObservationMock: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/kube-observation', (): object => ({ createKubeObservation: createObservationMock }));

const gateFailureMessage: string =
  'Resource endpoint resource-res-db.cpt-p1.svc:5432 did not accept a connection within 300ms.';

class StubKubeConfig {
  public makeApiClient(): StubCoreApi {
    return new StubCoreApiClient();
  }
}

class StubCoreApiClient implements StubCoreApi {}

class StubObjectApi {
  public async patch(object: KubeManifest): Promise<KubeManifest> {
    return await Promise.resolve(object);
  }

  public async read(object: KubeManifest): Promise<KubeManifest> {
    return await Promise.resolve(object);
  }

  public async delete(): Promise<void> {
    await Promise.resolve();
  }

  public setDefaultNamespace(): void {
    return undefined;
  }
}

describe('Job whose reachability gate never passed', (): void => {
  beforeEach((): void => {
    vi.restoreAllMocks();
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(new StubObjectApi() as never);
  });

  it('is terminal with the gate exit code instead of waiting out the Job timeout', async (): Promise<void> => {
    const terminal: TerminalJob = await waitForTerminalJob(gateFailureObservation('job-1'), 'job-1', 0);

    expect(terminal).toMatchObject({ exitCode: 1, initFailureMessage: gateFailureMessage, podName: 'job-pod' });
    expect(terminal.succeeded).toBe(false);
  });

  it('reports no log-bearing Pod, because the Job container never started', async (): Promise<void> => {
    const terminal: TerminalJob = await waitForTerminalJob(gateFailureObservation('job-1'), 'job-1', 0);

    expect(terminal.podNames).toEqual([]);
  });

  it('keeps a Pod that ran its own container reporting that container, not an init container', async (): Promise<void> => {
    const terminal: TerminalJob = await waitForTerminalJob(commandFailureObservation('job-1'), 'job-1', 0);

    expect(terminal).toMatchObject({ exitCode: 17, initFailureMessage: null, podNames: ['job-pod'] });
  });

  it('reports the last attempt when an earlier attempt failed in its own container instead', async (): Promise<void> => {
    const terminal: TerminalJob = await waitForTerminalJob(retriedIntoGateFailureObservation(), 'job-1', 0);

    expect(terminal).toMatchObject({ exitCode: 1, initFailureMessage: gateFailureMessage, podName: 'job-pod-2' });
  });

  it('reports the unreachable endpoint as the Job result the operator reads', async (): Promise<void> => {
    const spec: KubeJobSpec = jobSpec();
    createObservationMock.mockResolvedValue(gateFailureObservation(kubeJobName(spec.id)));
    const runtime: KubeRuntime = new KubeRuntime(new StubKubeConfig() as never);

    const result: KubeJobResult = await runtime.runJob(spec);

    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(result.logs).toContain('resource-res-db.cpt-p1.svc:5432');
  });
});

function jobSpec(): KubeJobSpec {
  return {
    env: {},
    id: 'release-dep-1',
    image: 'registry.example/app@sha256:abc',
    jobClass: 'release',
    labels: {},
    namespace: 'p1',
    timeoutMs: 60_000,
  };
}

function gateFailureObservation(jobName: string): KubeObservation {
  return observationOf(jobName, {
    containerStatuses: [{ name: 'job', state: { waiting: { reason: 'PodInitializing' } } }],
    initContainerStatuses: [
      { name: 'await-resources', state: { terminated: { exitCode: 1, message: gateFailureMessage } } },
    ],
  });
}

function commandFailureObservation(jobName: string): KubeObservation {
  return observationOf(jobName, {
    containerStatuses: [{ name: 'job', state: { terminated: { exitCode: 17 } } }],
    initContainerStatuses: [{ name: 'await-resources', state: { terminated: { exitCode: 0 } } }],
  });
}

class StaticObservation implements KubeObservation {
  public constructor(public readonly cache: ReadonlyMap<string, KubeObservedManifest>) {}

  public health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: null, lastErrorAt: null };
  }

  public onEvent(): () => void {
    return (): void => undefined;
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
  }
}

/** A Job that used its one retry: the first Pod's command failed, the second never got past its gate. */
function retriedIntoGateFailureObservation(): KubeObservation {
  return new StaticObservation(
    new Map([
      ...observationOf('job-1', { containerStatuses: [{ name: 'job', state: { terminated: { exitCode: 17 } } }] })
        .cache,
      [
        'pods/p1/job-pod-2',
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { labels: { 'job-name': 'job-1' }, name: 'job-pod-2' },
          status: {
            containerStatuses: [{ name: 'job', state: { waiting: { reason: 'PodInitializing' } } }],
            initContainerStatuses: [
              { name: 'await-resources', state: { terminated: { exitCode: 1, message: gateFailureMessage } } },
            ],
          },
        },
      ],
    ]),
  );
}

function observationOf(jobName: string, podStatus: ObservedPodStatus): KubeObservation {
  const cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>([
    [
      'jobs/p1/job',
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: jobName },
        status: { conditions: [{ status: 'True', type: 'Failed' }], failed: 1 },
      },
    ],
    [
      'pods/p1/job-pod',
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { labels: { 'job-name': jobName }, name: 'job-pod' },
        status: podStatus,
      },
    ],
  ]);
  return new StaticObservation(cache);
}
