import { setTimeout as sleep } from 'node:timers/promises';
import type { PublicControlPlaneObservation } from './kubernetes-install.service.types';

const publicControlPlanePollIntervalMs: number = 2_000;
const publicControlPlaneRequestTimeoutMs: number = 10_000;
const publicControlPlaneWaitTimeoutMs: number = 15 * 60_000;

export async function waitForPublicControlPlane(apiUrl: string): Promise<void> {
  const deadline: number = Date.now() + publicControlPlaneWaitTimeoutMs;
  let lastFailure: string = 'no response';
  while (Date.now() < deadline) {
    try {
      const observation: PublicControlPlaneObservation = await observePublicControlPlane(apiUrl);
      if (observation.ready) {
        return;
      }
      lastFailure = observation.failure;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'network request failed';
    }
    await sleep(publicControlPlanePollIntervalMs);
  }
  throw new Error(`Timed out waiting for the public Compartment control plane at ${apiUrl}: ${lastFailure}`);
}

async function observePublicControlPlane(apiUrl: string): Promise<PublicControlPlaneObservation> {
  const response: Response = await fetch(apiUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(publicControlPlaneRequestTimeoutMs),
  });
  const location: string | null = response.headers.get('location');
  const ready: boolean = response.status === 302 && location === '/login';
  await response.body?.cancel();
  return {
    failure: `HTTP ${response.status.toString()} with location ${location ?? '<none>'}`,
    ready,
  };
}
