import { Log, type LogOptions } from '@kubernetes/client-node';
import { getEventListeners } from 'node:events';
import type { Writable } from 'node:stream';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { followJobLogs } from '../src/kube-job-log-stream';
import { waitForJobPod } from '../src/kube-job-log-observation';
import type {
  KubeObservation,
  KubeObservationHealth,
  KubeObservationListener,
  KubeObservedManifest,
} from '../src/kube-runtime.types';

type FollowLog = (
  namespace: string,
  podName: string,
  containerName: string,
  stream: Writable,
  options?: LogOptions,
) => Promise<AbortController>;

describe('Kubernetes Job log stream', (): void => {
  it('removes the abort listener when cancellation races Pod subscription', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    const observation: AbortOnSubscribeObservation = new AbortOnSubscribeObservation(controller);

    await expect(waitForJobPod(observation, 'job-name', new Set<string>(), controller.signal)).rejects.toThrow(
      'cancelled while subscribing',
    );

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('drains a started Pod even when the Job is already terminal', async (): Promise<void> => {
    const observation: PodObservation = new PodObservation();
    observation.complete();
    const followLog: MockInstance<FollowLog> = vi
      .spyOn(Log.prototype, 'log')
      .mockImplementation(
        async (
          _namespace: string,
          _podName: string,
          _container: string,
          stream: Writable,
        ): Promise<AbortController> => {
          stream.end('terminal output\n');
          return await Promise.resolve(new AbortController());
        },
      );
    const chunks: string[] = [];

    await followJobLogs(
      {} as never,
      observation,
      'ns',
      'job-name',
      new AbortController().signal,
      (chunk: string): void => {
        chunks.push(chunk);
      },
    );

    expect(followLog).toHaveBeenCalledOnce();
    expect(chunks).toEqual(['terminal output\n']);
  });

  it('retries log attachment until it succeeds within the Job deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    const observation: PodObservation = new PodObservation();
    observation.complete();
    const controller: AbortController = new AbortController();
    const followLog: MockInstance<FollowLog> = vi
      .spyOn(Log.prototype, 'log')
      .mockRejectedValueOnce(new Error('container starting'))
      .mockRejectedValueOnce(new Error('log endpoint pending'))
      .mockImplementation(
        async (
          _namespace: string,
          _podName: string,
          _container: string,
          stream: Writable,
        ): Promise<AbortController> => {
          stream.end('attached\n');
          return await Promise.resolve(new AbortController());
        },
      );
    const pending: Promise<void> = followJobLogs(
      {} as never,
      observation,
      'ns',
      'job-name',
      controller.signal,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBeUndefined();
    expect(followLog).toHaveBeenCalledTimes(3);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('stops attachment retries when the Job deadline is cancelled', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    const followLog: MockInstance<FollowLog> = vi
      .spyOn(Log.prototype, 'log')
      .mockRejectedValue(new Error('container starting'));
    const pending: Promise<void> = followJobLogs(
      {} as never,
      new PodObservation(),
      'ns',
      'job-name',
      controller.signal,
      vi.fn(),
    );
    await vi.waitFor((): void => expect(followLog).toHaveBeenCalledOnce());

    controller.abort(new Error('deadline reached'));

    await expect(pending).rejects.toThrow('deadline reached');
  });

  it('preserves UTF-8 characters split across transport chunks', async (): Promise<void> => {
    const encoded: Buffer = Buffer.from('building 🚀\n');
    const splitAt: number = encoded.indexOf(0xf0) + 2;
    const observation: PodObservation = new PodObservation();
    vi.spyOn(Log.prototype, 'log').mockImplementation(
      async (_namespace: string, _podName: string, _container: string, stream: Writable): Promise<AbortController> => {
        stream.write(encoded.subarray(0, splitAt));
        stream.end(encoded.subarray(splitAt));
        observation.complete();
        return await Promise.resolve(new AbortController());
      },
    );
    const chunks: string[] = [];

    await followJobLogs(
      {} as never,
      observation,
      'ns',
      'job-name',
      new AbortController().signal,
      (chunk: string): void => {
        chunks.push(chunk);
      },
    );

    expect(chunks.join('')).toBe('building 🚀\n');
  });

  it('follows each retry Pod once', async (): Promise<void> => {
    const observation: PodObservation = new PodObservation();
    const chunks: string[] = [];
    const followLog: MockInstance<FollowLog> = vi
      .spyOn(Log.prototype, 'log')
      .mockImplementation(
        async (_namespace: string, podName: string, _container: string, stream: Writable): Promise<AbortController> => {
          stream.end(`${podName}\n`);
          return await Promise.resolve(new AbortController());
        },
      );
    const pending: Promise<void> = followJobLogs(
      {} as never,
      observation,
      'ns',
      'job-name',
      new AbortController().signal,
      (chunk: string): void => {
        chunks.push(chunk);
      },
    );

    await vi.waitFor((): void => expect(followLog).toHaveBeenCalledTimes(1));
    observation.recordFailedAttempt();
    observation.addRetryPod();
    await vi.waitFor((): void => expect(followLog).toHaveBeenCalledTimes(2));
    observation.complete();
    await pending;

    expect(chunks).toEqual(['job-pod\n', 'job-pod-retry\n']);
  });
});

class AbortOnSubscribeObservation implements KubeObservation {
  readonly cache: ReadonlyMap<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>();

  constructor(private readonly controller: AbortController) {}

  health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: null, lastErrorAt: null };
  }

  onEvent(): () => void {
    this.controller.abort(new Error('cancelled while subscribing'));
    return (): void => undefined;
  }

  async stop(): Promise<void> {
    await Promise.resolve();
  }
}

class PodObservation implements KubeObservation {
  public readonly cache: Map<string, KubeObservedManifest> = new Map<string, KubeObservedManifest>([
    ['pods/ns/job-pod', this.pod('job-pod')],
  ]);
  private readonly listeners: Set<KubeObservationListener> = new Set<KubeObservationListener>();

  public addRetryPod(): void {
    this.cache.set('pods/ns/job-pod-retry', this.pod('job-pod-retry'));
    this.emit('pods');
  }

  public complete(): void {
    this.cache.set('jobs/ns/job-name', {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: 'job-name' },
      status: { succeeded: 1 },
    });
    this.emit('jobs');
  }

  public recordFailedAttempt(): void {
    this.cache.set('jobs/ns/job-name', {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: 'job-name' },
      status: { failed: 1 },
    });
    this.emit('jobs');
  }

  public health(): KubeObservationHealth {
    return { healthy: true, lastConnectedAt: null, lastErrorAt: null };
  }

  public onEvent(listener: KubeObservationListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
  }

  private emit(resource: 'jobs' | 'pods'): void {
    for (const listener of this.listeners) {
      void listener({ object: this.cache.values().next().value!, observedAt: new Date(), resource, type: 'update' });
    }
  }

  private pod(podName: string): KubeObservedManifest {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { labels: { 'job-name': 'job-name' }, name: podName },
      status: { containerStatuses: [{ name: 'job', state: { running: {} } }] },
    };
  }
}
