import type { KubeConfig, KubernetesListObject, KubernetesObject } from '@kubernetes/client-node';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { calculateRestartDelay } from '../src/kube-backoff';
import { createRegisteredInformers, type RegisteredInformer } from '../src/kube-informer-registration';
import { createKubeObservation } from '../src/kube-observation';
import type { KubeObservation, KubeObservationEvent } from '../src';

type ObjectCallback = (object: KubernetesObject) => void;
type ErrorCallback = (error?: Error) => void;
type ListObjects = () => Promise<KubernetesListObject<KubernetesObject>>;
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
  private listObjects: ListObjects | null = null;

  public constructor(private readonly completesStartup: boolean = true) {}

  public on(event: string, callback: ObjectCallback | ErrorCallback): void {
    if (event === 'error') {
      this.errorCallbacks.push(callback as ErrorCallback);
    } else if (event === 'connect') {
      this.connectCallbacks.push(callback as ErrorCallback);
    } else {
      this.objectCallbacks.set(event, [...(this.objectCallbacks.get(event) ?? []), callback as ObjectCallback]);
    }
  }

  public async start(): Promise<void> {
    this.startCount += 1;
    if (!this.completesStartup) {
      await new Promise<void>((): void => undefined);
    }
    await this.completeInitialList();
    queueMicrotask((): void => this.emitConnect());
    await Promise.resolve();
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
    this.stopCount += 1;
  }

  public emitError(error: Error): void {
    this.errorCallbacks.forEach((callback: ErrorCallback): void => callback(error));
  }

  public emitConnect(): void {
    this.connectCallbacks.forEach((callback: ErrorCallback): void => callback());
  }

  public attachInitialList(listObjects: ListObjects): void {
    this.listObjects = listObjects;
  }

  protected async completeInitialList(): Promise<void> {
    await this.listObjects?.();
  }

  public emitObject(event: 'add' | 'delete' | 'update', object: KubernetesObject): void {
    this.objectCallbacks.get(event)?.forEach((callback: ObjectCallback): void => callback(object));
  }
}

class DeferredInitialListInformer extends FakeInformer {
  private completeStartup: (() => void) | null = null;

  public override async start(): Promise<void> {
    this.startCount += 1;
    await new Promise<void>((resolve: () => void): void => {
      this.completeStartup = resolve;
    });
  }

  public async publishInitialObject(object: KubernetesObject): Promise<void> {
    this.emitObject('add', object);
    await this.completeInitialList();
    this.completeStartup?.();
    this.completeStartup = null;
  }
}

class InitialListErrorInformer extends FakeInformer {
  public override async start(): Promise<void> {
    this.startCount += 1;
    if (this.startCount === 1) {
      queueMicrotask((): void => this.emitError(new Error('initial LIST failed')));
    } else {
      await this.completeInitialList();
      queueMicrotask((): void => this.emitConnect());
    }
    await Promise.resolve();
  }
}

class FakeObjectApi {
  public constructor(private readonly items: KubernetesObject[] = []) {}

  public async list(): Promise<{ items: KubernetesObject[]; metadata: { resourceVersion: string } }> {
    await Promise.resolve();
    return { items: this.items, metadata: { resourceVersion: '1' } };
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

  it('does not expose an observation before the initial informer list populates its cache', async (): Promise<void> => {
    const informer: DeferredInitialListInformer = new DeferredInitialListInformer();
    registerFakeInformers(informer);
    let settled: boolean = false;
    const startup: Promise<KubeObservation> = createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    }).then((observation: KubeObservation): KubeObservation => {
      settled = true;
      return observation;
    });
    await vi.waitFor((): void => {
      expect(informer.startCount).toBe(1);
    });
    expect(settled).toBe(false);

    await informer.publishInitialObject(deploymentObject());
    const observation: KubeObservation = await startup;

    expect(observation.cache.has('deployments/cpt-prj-1/app-dep-1')).toBe(true);
    await observation.stop();
  });

  it('retries an initial LIST error instead of synchronizing an empty cache', async (): Promise<void> => {
    vi.useFakeTimers();
    const informer: InitialListErrorInformer = new InitialListErrorInformer();
    registerFakeInformers(informer);
    let settled: boolean = false;
    const startup: Promise<KubeObservation> = createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    }).then((observation: KubeObservation): KubeObservation => {
      settled = true;
      return observation;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(informer.startCount).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(375);

    const observation: KubeObservation = await startup;
    expect(informer.startCount).toBe(2);
    expect(observation.health().healthy).toBe(true);
    await observation.stop();
  });

  it('normalizes initial list objects to the same manifest identity as watch events', async (): Promise<void> => {
    let listObjects: (() => Promise<KubernetesListObject<KubernetesObject>>) | null = null;
    createInformerMock.mockImplementation(
      (
        _config: KubeConfig,
        _path: string,
        list: () => Promise<KubernetesListObject<KubernetesObject>>,
      ): FakeInformer => {
        listObjects = list;
        return new FakeInformer();
      },
    );
    const [registration]: RegisteredInformer[] = createRegisteredInformers(
      {} as never,
      new FakeObjectApi([{ metadata: { name: 'app-dep-1', namespace: 'cpt-prj-1' } }]) as never,
      {
        labels: { 'compartment.dev/deployment-id': 'dep-1' },
        namespace: 'cpt-prj-1',
        resources: ['deployments'],
      },
    );
    registration!.createInformer();

    const listed: KubernetesListObject<KubernetesObject> = await listObjects!();

    expect(listed.items).toEqual([
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'app-dep-1', namespace: 'cpt-prj-1' },
      },
    ]);
  });

  it('restarts after disconnect and keeps health and observedAt cache state', async (): Promise<void> => {
    vi.useFakeTimers();
    const informer: FakeInformer = new FakeInformer();
    registerFakeInformers(informer);
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
    registerFakeInformers(expiredInformer, relistedInformer);
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
    registerFakeInformers(expiredInformer, relistedInformer);
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

  it('backs off repeated delivery failures while retaining the same event', async (): Promise<void> => {
    vi.useFakeTimers();
    const informer: FakeInformer = new FakeInformer();
    registerFakeInformers(informer);
    const observation: KubeObservation = await createKubeObservation({} as never, new FakeObjectApi() as never, {
      labels: { 'compartment.dev/deployment-id': 'dep-1' },
      namespace: 'cpt-prj-1',
      resources: ['deployments'],
    });
    const delivered: KubeObservationEvent[] = [];
    const listener: Mock = vi.fn(async (event: KubeObservationEvent): Promise<void> => {
      await Promise.resolve();
      delivered.push(event);
      if (delivered.length < 3) {
        throw new Error('database unavailable');
      }
    });
    observation.onEvent(listener);
    informer.emitObject('add', deploymentObject());
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(375);
    expect(listener).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(750);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(delivered[1]).toBe(delivered[0]);
    expect(delivered[2]).toBe(delivered[0]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listener).toHaveBeenCalledTimes(3);
    await observation.stop();
  });

  it('stops every informer when startup is aborted after a partial connect', async (): Promise<void> => {
    vi.useFakeTimers();
    const connectedInformer: FakeInformer = new FakeInformer();
    const hangingInformer: FakeInformer = new FakeInformer(false);
    registerFakeInformers(connectedInformer, hangingInformer);
    const controller: AbortController = new AbortController();
    const startup: Promise<KubeObservation> = createKubeObservation(
      {} as never,
      new FakeObjectApi() as never,
      {
        labels: { 'compartment.dev/job-id': 'job-1' },
        namespace: 'cpt-prj-1',
        resources: ['jobs', 'pods'],
      },
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('deadline'));
    await expect(startup).rejects.toThrow('deadline');
    expect(connectedInformer.stopCount).toBe(1);
    expect(hangingInformer.stopCount).toBe(1);
  });
});

function deploymentObject(): KubernetesObject {
  return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'app-dep-1', namespace: 'cpt-prj-1' } };
}

function expiredWatchError(): ExpiredWatchError {
  return Object.assign(new Error('Gone'), { statusCode: 410 });
}

function registerFakeInformers(...informers: FakeInformer[]): void {
  let index: number = 0;
  createInformerMock.mockImplementation(
    (_config: KubeConfig, _path: string, listObjects: ListObjects): FakeInformer => {
      const informer: FakeInformer | undefined = informers[index];
      index += 1;
      if (informer === undefined) {
        throw new Error('Unexpected informer creation.');
      }
      informer.attachInitialList(listObjects);
      return informer;
    },
  );
}
