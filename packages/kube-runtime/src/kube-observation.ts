import { randomInt } from 'node:crypto';
import type { Informer, KubeConfig, KubernetesObject, KubernetesObjectApi } from '@kubernetes/client-node';
import { calculateRestartDelay } from './kube-backoff';
import { createRegisteredInformers, type RegisteredInformer } from './kube-informer-registration';
import type {
  KubeManifest,
  KubeObservation,
  KubeObservationEvent,
  KubeObservationEventType,
  KubeObservationHealth,
  KubeObservationListener,
  KubeObservedResource,
  ObserveLabels,
} from './kube-runtime.types';

interface InformerState {
  attempt: number;
  informer: Informer<KubernetesObject>;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  registration: RegisteredInformer;
  restartTimer: NodeJS.Timeout | null;
}

interface KubeInformerError extends Error {
  code?: number | undefined;
  statusCode?: number | undefined;
}

export async function createKubeObservation(
  kubeConfig: KubeConfig,
  objectApi: KubernetesObjectApi,
  input: ObserveLabels,
): Promise<KubeObservation> {
  const registered: RegisteredInformer[] = createRegisteredInformers(kubeConfig, objectApi, input);
  const observation: RuntimeObservation = new RuntimeObservation();
  await observation.start(registered);
  return observation;
}

class RuntimeObservation implements KubeObservation {
  public readonly cache: Map<string, KubeManifest> = new Map<string, KubeManifest>();
  private readonly deliveryTimers: Set<NodeJS.Timeout> = new Set<NodeJS.Timeout>();
  private readonly listeners: Set<KubeObservationListener> = new Set<KubeObservationListener>();
  private readonly states: InformerState[] = [];
  private stopping: boolean = false;

  public async start(registered: RegisteredInformer[]): Promise<void> {
    await Promise.all(
      registered.map(async (item: RegisteredInformer): Promise<void> => await this.startInformer(item)),
    );
  }

  public health(): KubeObservationHealth {
    const connections: Date[] = this.states.flatMap((state: InformerState): Date[] => dateValue(state.lastConnectedAt));
    const errors: Date[] = this.states.flatMap((state: InformerState): Date[] => dateValue(state.lastErrorAt));
    return {
      healthy: this.states.length > 0 && this.states.every((state: InformerState): boolean => this.isHealthy(state)),
      lastConnectedAt: latest(connections),
      lastErrorAt: latest(errors),
    };
  }

  public onEvent(listener: KubeObservationListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    for (const state of this.states) cancelRestart(state);
    for (const timer of this.deliveryTimers) clearTimeout(timer);
    this.deliveryTimers.clear();
    await Promise.all(this.states.map(async (state: InformerState): Promise<void> => await state.informer.stop()));
  }

  private async startInformer(registration: RegisteredInformer): Promise<void> {
    const state: InformerState = newInformerState(registration);
    this.states.push(state);
    await new Promise<void>((resolve: () => void): void => {
      this.registerCallbacks(state, resolve);
      this.attemptStart(state);
    });
  }

  private registerCallbacks(state: InformerState, onConnect: () => void = (): void => undefined): void {
    const resource: KubeObservedResource = state.registration.definition.resource;
    state.informer.on('connect', (): void => {
      markConnected(state);
      onConnect();
    });
    state.informer.on('add', (object: KubernetesObject): void => this.acceptSafely('add', resource, object));
    state.informer.on('update', (object: KubernetesObject): void => this.acceptSafely('update', resource, object));
    state.informer.on('delete', (object: KubernetesObject): void => this.acceptSafely('delete', resource, object));
    state.informer.on('error', (error?: KubeInformerError): void => this.scheduleRestart(state, error));
  }

  private attemptStart(state: InformerState): void {
    if (this.stopping) return;
    void state.informer.start().catch((error: Error): void => this.scheduleRestart(state, error));
  }

  private scheduleRestart(state: InformerState, error?: KubeInformerError): void {
    if (this.stopping || state.restartTimer !== null) return;
    state.lastErrorAt = new Date();
    const relist: boolean = error?.statusCode === 410 || error?.code === 410;
    const delay: number = relist ? 0 : restartDelay(state.attempt);
    state.attempt += 1;
    state.restartTimer = setTimeout((): void => {
      state.restartTimer = null;
      if (relist) void this.relist(state);
      else this.attemptStart(state);
    }, delay);
  }

  private async relist(state: InformerState): Promise<void> {
    try {
      await state.informer.stop();
      const resource: KubeObservedResource = state.registration.definition.resource;
      this.clearResourceCache(resource);
      state.informer = state.registration.createInformer();
      this.registerCallbacks(state, (): void => {
        this.dispatchSafely({ observedAt: new Date(), resource, type: 'relist' });
      });
      this.attemptStart(state);
    } catch (error) {
      this.scheduleRestart(state, error as KubeInformerError);
    }
  }

  private clearResourceCache(resource: KubeObservedResource): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${resource}/`)) this.cache.delete(key);
    }
  }

  private async accept(
    type: KubeObservationEventType,
    resource: KubeObservedResource,
    object: KubernetesObject,
  ): Promise<void> {
    const manifest: KubeManifest = object;
    const key: string = `${resource}/${object.metadata?.namespace ?? ''}/${object.metadata?.name ?? ''}`;
    if (type === 'delete') this.cache.delete(key);
    else this.cache.set(key, manifest);
    const event: KubeObservationEvent = { object: manifest, observedAt: new Date(), resource, type };
    await this.dispatch(event);
  }

  private async dispatch(event: KubeObservationEvent): Promise<void> {
    await Promise.all(
      [...this.listeners].map(async (listener: KubeObservationListener): Promise<void> => await listener(event)),
    );
  }

  private acceptSafely(type: KubeObservationEventType, resource: KubeObservedResource, object: KubernetesObject): void {
    void this.accept(type, resource, object).catch((): void => {
      if (this.stopping) return;
      this.scheduleDelivery((): void => this.acceptSafely(type, resource, object));
    });
  }

  private dispatchSafely(event: KubeObservationEvent): void {
    void this.dispatch(event).catch((): void => {
      if (this.stopping) return;
      this.scheduleDelivery((): void => this.dispatchSafely(event));
    });
  }

  private scheduleDelivery(deliver: () => void): void {
    const timer: NodeJS.Timeout = setTimeout((): void => {
      this.deliveryTimers.delete(timer);
      if (!this.stopping) deliver();
    }, restartDelay(0));
    this.deliveryTimers.add(timer);
  }

  private isHealthy(state: InformerState): boolean {
    return (
      state.lastConnectedAt !== null &&
      (state.lastErrorAt === null || state.lastConnectedAt.getTime() >= state.lastErrorAt.getTime())
    );
  }
}

function newInformerState(registration: RegisteredInformer): InformerState {
  return {
    attempt: 0,
    informer: registration.createInformer(),
    lastConnectedAt: null,
    lastErrorAt: null,
    registration,
    restartTimer: null,
  };
}

function markConnected(state: InformerState): void {
  state.attempt = 0;
  state.lastConnectedAt = new Date();
  cancelRestart(state);
}

function cancelRestart(state: InformerState): void {
  if (state.restartTimer !== null) clearTimeout(state.restartTimer);
  state.restartTimer = null;
}

function restartDelay(attempt: number): number {
  return calculateRestartDelay(attempt, randomInt(500, 1_501));
}

function dateValue(value: Date | null): Date[] {
  return value === null ? [] : [value];
}

function latest(values: Date[]): Date | null {
  return values.length === 0 ? null : new Date(Math.max(...values.map((value: Date): number => value.getTime())));
}
