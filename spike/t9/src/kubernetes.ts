const clientNodePackage = ['@kubernetes', 'client-node'].join('/');
const k8s: any = await import(clientNodePackage);

export interface CachedObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string>; generation?: number };
  spec?: any;
  status?: any;
}

interface Informer {
  on(event: string, callback: (value?: any) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
import type { DesiredSpec } from './types.js';

const namespace = 't9';
const trackLabels = { 'compartment.track': 't9' };
const selector = 'compartment.track=t9';

export interface CacheEvent {
  type: 'add' | 'update' | 'delete';
  kind: 'Deployment' | 'Service' | 'Job' | 'Pod';
  object: CachedObject;
}

export class KubernetesRuntime {
  private readonly apps: any;
  private readonly core: any;
  private readonly batch: any;
  private readonly objectApi: any;
  private readonly informers: Informer[] = [];
  private readonly cache = new Map<string, CachedObject>();
  private stopping = false;

  public constructor(private readonly kubeConfig: any) {
    this.apps = kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.core = kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.batch = kubeConfig.makeApiClient(k8s.BatchV1Api);
    this.objectApi = k8s.KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  public async start(onEvent: (event: CacheEvent) => Promise<void>): Promise<void> {
    await this.core.createNamespace({ body: { metadata: { name: namespace } } }).catch((error: unknown) => {
      if ((error as { code?: number }).code !== 409) throw error;
    });
    const definitions: Array<
      [CacheEvent['kind'], string, () => Promise<{ items: CachedObject[]; metadata?: { resourceVersion?: string } }>]
    > = [
      [
        'Deployment',
        `/apis/apps/v1/namespaces/${namespace}/deployments`,
        async () => this.apps.listNamespacedDeployment({ namespace, labelSelector: selector }),
      ],
      [
        'Service',
        `/api/v1/namespaces/${namespace}/services`,
        async () => this.core.listNamespacedService({ namespace, labelSelector: selector }),
      ],
      [
        'Job',
        `/apis/batch/v1/namespaces/${namespace}/jobs`,
        async () => this.batch.listNamespacedJob({ namespace, labelSelector: selector }),
      ],
      [
        'Pod',
        `/api/v1/namespaces/${namespace}/pods`,
        async () => this.core.listNamespacedPod({ namespace, labelSelector: selector }),
      ],
    ];
    const ready: Array<Promise<void>> = [];
    for (const [kind, path, list] of definitions) {
      let markListed: () => void = () => undefined;
      const listed = new Promise<void>((resolve) => {
        markListed = resolve;
      });
      const informer = k8s.makeInformer(
        this.kubeConfig,
        path,
        async () => {
          const result = await list();
          markListed();
          return result;
        },
        selector,
      );
      let restartTimer: NodeJS.Timeout | undefined;
      const attempt = (): void => {
        if (this.stopping) return;
        void informer.start().catch(scheduleRestart);
      };
      const scheduleRestart = (error: unknown): void => {
        if (this.stopping || restartTimer) return;
        console.error('INFORMER_ERROR', kind, error);
        restartTimer = setTimeout(() => {
          restartTimer = undefined;
          attempt();
        }, 1_000);
      };
      const connected = new Promise<void>((resolve) =>
        informer.on('connect', () => {
          if (restartTimer) clearTimeout(restartTimer);
          restartTimer = undefined;
          resolve();
        }),
      );
      ready.push(Promise.all([connected, listed]).then(() => undefined));
      for (const type of ['add', 'update', 'delete'] as const)
        informer.on(type, (object: CachedObject) => void this.accept(type, kind, object, onEvent));
      informer.on('error', scheduleRestart);
      this.informers.push(informer as Informer);
      attempt();
    }
    await Promise.all(ready);
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.informers.map(async (informer) => informer.stop()));
  }

  public get(kind: CacheEvent['kind'], id: string): CachedObject | undefined {
    return this.cache.get(`${kind}/${id}`);
  }

  public cacheIds(kind: CacheEvent['kind']): string[] {
    return [...this.cache.entries()]
      .filter(([key]) => key.startsWith(`${kind}/`))
      .map(([key]) => key.split('/')[1]!)
      .sort();
  }

  public async applyBundle(id: string, spec: DesiredSpec, force = false): Promise<void> {
    const labels = { ...trackLabels, 'compartment.id': id };
    const name = objectName(id);
    const deployment: CachedObject = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace, labels },
      spec: {
        replicas: spec.replicas,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name: 'app',
                image: spec.image,
                env: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
              },
            ],
          },
        },
      },
    };
    const service: CachedObject = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace, labels },
      spec: { selector: labels, ports: [{ name: 'http', port: 80, targetPort: 8080 }] },
    };
    await this.apply(deployment, force);
    await this.apply(service, force);
  }

  public async applyJob(id: string): Promise<void> {
    const labels = { ...trackLabels, 'compartment.id': id };
    const job: CachedObject = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: `${objectName(id)}-job`, namespace, labels },
      spec: {
        template: {
          metadata: { labels },
          spec: {
            restartPolicy: 'Never',
            containers: [{ name: 'job', image: 'busybox:1.36', command: ['sh', '-c', 'sleep 15; echo t9-job-result'] }],
          },
        },
        backoffLimit: 1,
      },
    };
    await this.apply(job, false);
  }

  public async jobResult(id: string): Promise<string> {
    const pod = this.get('Pod', id);
    const name = pod?.metadata?.name;
    if (!name) throw new Error(`job pod missing from informer cache: ${id}`);
    return (await this.core.readNamespacedPodLog({ name, namespace, container: 'job' })).trim();
  }

  private async apply(body: CachedObject, force: boolean): Promise<void> {
    await this.objectApi.patch(body, undefined, undefined, 'compartment-t9', force, k8s.PatchStrategy.ServerSideApply);
  }

  private async accept(
    type: CacheEvent['type'],
    kind: CacheEvent['kind'],
    object: CachedObject,
    onEvent: (event: CacheEvent) => Promise<void>,
  ): Promise<void> {
    const id = object.metadata?.labels?.['compartment.id'];
    if (!id || object.metadata?.labels?.['compartment.track'] !== 't9') return;
    const key = `${kind}/${id}`;
    if (type === 'delete') this.cache.delete(key);
    else this.cache.set(key, object);
    await onEvent({ type, kind, object });
  }
}

export function objectName(id: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(id)) throw new Error(`invalid canonical id: ${id}`);
  return `t9-${id}`;
}

export function loadKubeConfig(): any {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  config.setCurrentContext('k3d-cpt-t9');
  return config;
}
