import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KubernetesRuntime, type CacheEvent, type CachedObject } from './kubernetes.js';
import { Store } from './store.js';
import type { Row } from './types.js';

export class Controller {
  private readonly busy = new Set<string>();
  private readonly dirty = new Set<string>();

  public constructor(
    private readonly store: Store,
    private readonly runtime: KubernetesRuntime,
    private readonly markerPath: string,
  ) {}

  public async start(): Promise<void> {
    await this.runtime.start(async (event) => this.onEvent(event));
    for (const row of (await this.store.read()).rows) await this.reconcile(row.id, 'startup');
  }

  public async stop(): Promise<void> {
    await this.runtime.stop();
  }

  private async onEvent(event: CacheEvent): Promise<void> {
    const id = event.object.metadata?.labels?.['compartment.id'];
    if (!id) return;
    if (event.type === 'delete') await this.store.audit({ id, kind: 'deleted', detail: `${event.kind} deleted` });
    await failpoint('during-informer-event', this.markerPath);
    await this.reconcile(id, `informer-${event.type}`);
  }

  private async reconcile(id: string, reason: string): Promise<void> {
    if (this.busy.has(id)) {
      this.dirty.add(id);
      return;
    }
    this.busy.add(id);
    try {
      const row = (await this.store.read()).rows.find((candidate) => candidate.id === id);
      if (!row) return;
      const cachedDeployment = this.runtime.get('Deployment', id);
      if (row.status === 'desired' || bundleDrifted(cachedDeployment, this.runtime.get('Service', id), row)) {
        if (row.status !== 'desired' && cachedDeployment)
          await this.store.audit({ id, kind: 'drift', detail: 'owned fields differ from desired' });
        try {
          await this.runtime.applyBundle(id, row.desiredSpec);
        } catch (error) {
          if ((error as { code?: number }).code === 409) {
            await this.store.audit({ id, kind: 'conflict', detail: String(error) });
            await this.store.patch(id, { status: 'pending', observedAt: null });
            console.error('DRIFT_CONFLICT', id, error);
            await this.runtime.applyBundle(id, row.desiredSpec, true);
          } else {
            throw error;
          }
        }
        await failpoint('after-apply-before-pending', this.markerPath);
        await this.store.patch(id, { status: 'pending' });
        await failpoint('after-apply-before-ready', this.markerPath);
      }
      const deployment = this.runtime.get('Deployment', id);
      if (isReady(deployment, row.desiredSpec.replicas)) {
        await this.store.patch(id, { status: 'active', observedAt: new Date().toISOString() });
      } else if (row.status === 'active') {
        await this.store.patch(id, { status: 'pending' });
        await this.store.audit({ id, kind: 'drift', detail: `active became non-ready (${reason})` });
      }
      await this.reconcileJob(row);
      const rows = (await this.store.read()).rows;
      if (rows.length > 0 && rows.every((candidate) => candidate.status === 'active')) {
        await writeFile(
          this.markerPath.replace('killpoint', 'cache.json'),
          JSON.stringify({
            deployments: this.runtime.cacheIds('Deployment'),
            services: this.runtime.cacheIds('Service'),
          }),
        );
      }
    } finally {
      this.busy.delete(id);
      if (this.dirty.delete(id)) await this.reconcile(id, 'coalesced-event');
    }
  }

  private async reconcileJob(row: Row): Promise<void> {
    if (!row.id.startsWith('job-')) return;
    const job = this.runtime.get('Job', row.id);
    if (!job) await this.runtime.applyJob(row.id);
    else if ((job.status?.succeeded ?? 0) > 0 && !row.jobResult)
      await this.store.patch(row.id, { jobResult: await this.runtime.jobResult(row.id) });
  }
}

function isReady(deployment: CachedObject | undefined, replicas: number): boolean {
  if (!deployment) return false;
  return (
    deployment.status?.observedGeneration === deployment.metadata?.generation &&
    (deployment.status?.availableReplicas ?? 0) >= replicas
  );
}

function bundleDrifted(deployment: CachedObject | undefined, service: unknown, row: Row): boolean {
  const container = deployment?.spec?.template.spec?.containers[0];
  const actualEnv = Object.fromEntries(
    (container?.env ?? []).flatMap((entry: { name: string; value?: string }) =>
      entry.value === undefined ? [] : [[entry.name, entry.value]],
    ),
  );
  return (
    !deployment ||
    !service ||
    deployment.spec?.replicas !== row.desiredSpec.replicas ||
    container?.image !== row.desiredSpec.image ||
    JSON.stringify(actualEnv) !== JSON.stringify(row.desiredSpec.env)
  );
}

export async function failpoint(name: string, markerPath: string): Promise<void> {
  if (process.env.T9_KILLPOINT !== name) return;
  await mkdir(dirname(markerPath), { recursive: true });
  await appendFile(markerPath, `${name} ${process.pid}\n`);
  process.kill(process.pid, 'SIGSTOP');
}
