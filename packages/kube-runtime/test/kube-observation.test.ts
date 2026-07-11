import type { KubernetesObject } from '@kubernetes/client-node';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { calculateRestartDelay } from '../src/kube-backoff';
import { createKubeObservation } from '../src/kube-observation';
import type { KubeObservation, KubeObservationEvent } from '../src';

type ObjectCallback = (object: KubernetesObject) => void;
type ErrorCallback = (error?: Error) => void;
interface ExpiredWatchError extends Error {
  statusCode: number;
}
const createInformerMock: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/kube-client-node', (): object => ({ createKubeInformer: createInformerMock }));

class FakeInformer {
  public startCount: number = 0;
  public stopCount: number = 0;
  private readonly errorCallbacks: ErrorCallback[] = [];
  private readonly connectCallbacks: ErrorCallback[] = [];
  private readonly objectCallbacks: Map<string, ObjectCallback[]> = new Map<string, ObjectCallback[]>();

  public on(event: string, callback: ObjectCallback | ErrorCallback): void {
    if (event === 'error') this.errorCallbacks.push(callback as ErrorCallback);
    else if (event === 'connect') this.connectCallbacks.push(callback as ErrorCallback);
    else this.objectCallbacks.set(event, [...(this.objectCallbacks.get(event) ?? []), callback as ObjectCallback]);
  }

  public async start(): Promise<void> {
    await Promise.resolve();
    this.startCount += 1;
    queueMicrotask((): void => this.connectCallbacks.forEach((callback: ErrorCallback): void => callback()));
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
    this.stopCount += 1;
  }

  public emitError(error: Error): void {
    this.errorCallbacks.forEach((callback: ErrorCallback): void => callback(error));
  }

  public emitObject(event: 'add' | 'delete' | 'update', object: KubernetesObject): void {
    this.objectCallbacks.get(event)?.forEach((callback: ObjectCallback): void => callback(object));
  }
}

class FakeObjectApi {
  public async list(): Promise<{ items: KubernetesObject[]; metadata: { resourceVersion: string } }> {
    await Promise.resolve();
    return { items: [], metadata: { resourceVersion: '1' } };
  }
}

describe('informer lifecycle', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies jitter without exceeding the restart cap', (): void => {
    expect(calculateRestartDelay(0, 1_500)).toBe(375);
    expect(calculateRestartDelay(100, 1_500)).toBe(30_000);
  });

  it('restarts after disconnect and keeps health and observedAt cache state', async (): Promise<void> => {
    vi.useFakeTimers();
    const informer: FakeInformer = new FakeInformer();
    createInformerMock.mockReturnValue(informer);
    const observation: KubeObservation = await createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    });
    const events: KubeObservationEvent[] = [];
    observation.onEvent((event: KubeObservationEvent): void => {
      events.push(event);
    });
    informer.emitObject('add', deploymentObject());
    await vi.advanceTimersByTimeAsync(0);
    expect(events[0]?.observedAt).toBeInstanceOf(Date);
    expect(observation.cache.size).toBe(1);

    informer.emitError(new Error('ECONNRESET'));
    await vi.advanceTimersByTimeAsync(375);
    expect(informer.startCount).toBe(2);
    expect(observation.health().healthy).toBe(true);
    expect(observation.health().lastErrorAt).toBeInstanceOf(Date);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(observation.health().healthy).toBe(true);
    await observation.stop();
    informer.emitError(new Error('late disconnect'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(informer.startCount).toBe(2);
    expect(informer.stopCount).toBe(1);
  });

  it('recreates the informer for a full relist after HTTP 410', async (): Promise<void> => {
    vi.useFakeTimers();
    const expiredInformer: FakeInformer = new FakeInformer();
    const relistedInformer: FakeInformer = new FakeInformer();
    createInformerMock.mockReturnValueOnce(expiredInformer).mockReturnValueOnce(relistedInformer);
    const observation: KubeObservation = await createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    });
    expiredInformer.emitObject('add', deploymentObject());
    await vi.advanceTimersByTimeAsync(0);
    expect(observation.cache.size).toBe(1);
    const events: KubeObservationEvent[] = [];
    observation.onEvent((event: KubeObservationEvent): void => {
      events.push(event);
    });
    expiredInformer.emitError(expiredWatchError());
    await vi.advanceTimersByTimeAsync(0);
    expect(observation.cache.size).toBe(0);
    expect(events).toMatchObject([{ resource: 'deployments', type: 'relist' }]);
    expect(expiredInformer.stopCount).toBe(1);
    expect(relistedInformer.startCount).toBe(1);
    expect(createInformerMock).toHaveBeenCalledTimes(2);
    await observation.stop();
  });

  it('completes a 410 relist even when a relist listener rejects', async (): Promise<void> => {
    vi.useFakeTimers();
    const expiredInformer: FakeInformer = new FakeInformer();
    const relistedInformer: FakeInformer = new FakeInformer();
    createInformerMock.mockReturnValueOnce(expiredInformer).mockReturnValueOnce(relistedInformer);
    const observation: KubeObservation = await createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    });
    const listener: Mock = vi.fn(async (): Promise<void> => await Promise.reject(new Error('database unavailable')));
    observation.onEvent(listener);
    expiredInformer.emitError(expiredWatchError());
    await vi.advanceTimersByTimeAsync(0);
    expect(relistedInformer.startCount).toBe(1);
    expect(createInformerMock).toHaveBeenCalledTimes(2);
    await observation.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listener).toHaveBeenCalledOnce();
  });
});

function deploymentObject(): KubernetesObject {
  return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'app-dep-1', namespace: 'cpt-prj-1' } };
}

function expiredWatchError(): ExpiredWatchError {
  return Object.assign(new Error('Gone'), { statusCode: 410 });
}
