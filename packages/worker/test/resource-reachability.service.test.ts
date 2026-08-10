import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProductJobIntent } from '@compartment/contracts';
import type { ResourceReachabilityTarget } from '../src/resource-reachability-probe.types';
import { kubeNamespaceName, kubeResourceName, type KubeResourceReachabilityProbe } from '@compartment/kube-runtime';
import { productJobResourceProbe, resourceReachabilityProbe } from '../src/resource-reachability-probe';
import { awaitResourceReachability } from '../src/services/resource-reachability.service';

const listeners: Server[] = [];
const blackholeHost: string = '192.0.2.1';
const connectAttemptTimeoutMs: number = 2_000;

afterEach(async (): Promise<void> => {
  await Promise.all(listeners.splice(0).map(closeListener));
});

describe('resource reachability wait', (): void => {
  it('returns once an endpoint that starts refusing connections begins accepting them', async (): Promise<void> => {
    const port: number = await reservedPort();

    const waited: Promise<void> = awaitResourceReachability([{ host: '127.0.0.1', port, timeoutMs: 10_000 }]);
    await listenLater(port, 400);

    await expect(waited).resolves.toBeUndefined();
  });

  it('gives up past the declared budget and names the endpoint it could not reach', async (): Promise<void> => {
    const port: number = await reservedPort();

    await expect(awaitResourceReachability([{ host: '127.0.0.1', port, timeoutMs: 300 }])).rejects.toThrow(
      `Resource endpoint 127.0.0.1:${port} did not accept a connection within 300ms.`,
    );
  });

  it('bounds the attempt itself, so a silently dropped connection cannot overrun the budget', async (): Promise<void> => {
    const startedAt: number = Date.now();

    // TEST-NET-1 is unroutable, so the SYN is dropped rather than refused and the attempt hangs. Only bounding the
    // attempt by the remaining budget keeps a short timeout short.
    await expect(awaitResourceReachability([{ host: blackholeHost, port: 5432, timeoutMs: 300 }])).rejects.toThrow(
      `${blackholeHost}:5432`,
    );

    expect(Date.now() - startedAt).toBeLessThan(connectAttemptTimeoutMs);
  });

  it('waits for every declared endpoint, not just the first', async (): Promise<void> => {
    const reachable: number = await listeningPort();
    const unreachable: number = await reservedPort();

    await expect(
      awaitResourceReachability([
        { host: '127.0.0.1', port: reachable, timeoutMs: 5_000 },
        { host: '127.0.0.1', port: unreachable, timeoutMs: 300 },
      ]),
    ).rejects.toThrow(`127.0.0.1:${unreachable}`);
  });
});

describe('resource reachability probe', (): void => {
  it('resolves each resource to its own headless Service address and declared port', (): void => {
    const probe: KubeResourceReachabilityProbe | undefined = resourceReachabilityProbe(
      [{ port: 5432, resourceId: 'res_db', timeoutMs: 30_000 }],
      'prj_1',
      'compartment-worker@sha256:worker',
    );

    // The address the probe dials must be the resource Service the runtime layer actually projects.
    expect(targetsOf(probe)).toEqual([
      { host: `${kubeResourceName('res_db')}.${kubeNamespaceName('prj_1')}.svc`, port: 5432, timeoutMs: 30_000 },
    ]);
  });

  it('never lets a Job wait longer for a resource than the Job has left to run', (): void => {
    const probe: KubeResourceReachabilityProbe | undefined = productJobResourceProbe(
      operationIntent(20_000),
      [{ deadlineAt: '2026-07-12T12:00:00.000Z', port: 5432, resourceId: 'res_db', timeoutMs: 300_000 }],
      'compartment-worker@sha256:worker',
    );

    expect(targetsOf(probe)[0]?.timeoutMs).toBe(20_000);
  });

  it('keeps the declared budget when the Job has more time than the resource asks for', (): void => {
    const probe: KubeResourceReachabilityProbe | undefined = productJobResourceProbe(
      operationIntent(600_000),
      [{ deadlineAt: '2026-07-12T12:00:00.000Z', port: 5432, resourceId: 'res_db', timeoutMs: 30_000 }],
      'compartment-worker@sha256:worker',
    );

    expect(targetsOf(probe)[0]?.timeoutMs).toBe(30_000);
  });

  it('produces no probe for a workload that dials nothing', (): void => {
    expect(resourceReachabilityProbe([], 'prj_1', 'compartment-worker@sha256:worker')).toBeUndefined();
    expect(productJobResourceProbe(operationIntent(600_000), [], 'compartment-worker@sha256:worker')).toBeUndefined();
  });
});

function targetsOf(probe: KubeResourceReachabilityProbe | undefined): ResourceReachabilityTarget[] {
  const serialized: string | undefined = probe?.env.COMPARTMENT_RESOURCE_REACHABILITY_TARGETS;
  return serialized === undefined ? [] : (JSON.parse(serialized) as ResourceReachabilityTarget[]);
}

function operationIntent(timeoutMs: number): ProductJobIntent {
  return {
    command: ['sh', '-c', 'true'],
    env: {},
    image: 'postgres:16-alpine',
    jobClass: 'resource-operation',
    namespace: 'cpt-prj-1',
    operationId: 'op_1',
    projectId: 'prj_1',
    resourceIds: ['res_db'],
    runtimeIdentity: 'resource',
    timeoutMs,
  };
}

async function listeningPort(): Promise<number> {
  const server: Server = createServer();
  listeners.push(server);
  return await new Promise<number>((resolve: (port: number) => void): void => {
    server.listen(0, '127.0.0.1', (): void => resolve((server.address() as AddressInfo).port));
  });
}

/** A port nothing is bound to, so a connection to it is actively refused rather than dropped. */
async function reservedPort(): Promise<number> {
  const server: Server = createServer();
  const port: number = await new Promise<number>((resolve: (value: number) => void): void => {
    server.listen(0, '127.0.0.1', (): void => resolve((server.address() as AddressInfo).port));
  });
  await closeListener(server);
  return port;
}

async function listenLater(port: number, delayMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, delayMs);
  });
  const server: Server = createServer();
  listeners.push(server);
  await new Promise<void>((resolve: () => void): void => {
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function closeListener(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => resolve());
  });
}
