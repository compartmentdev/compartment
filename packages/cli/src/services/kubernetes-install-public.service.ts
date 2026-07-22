import { waitForInstallDelay } from './kubernetes-install-delay.service';
import type { PublicControlPlaneObservation } from './kubernetes-install.service.types';

const publicControlPlanePollIntervalMs: number = 2_000;
const publicControlPlaneRequestTimeoutMs: number = 10_000;
const publicControlPlaneWaitTimeoutMs: number = 5 * 60_000;

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
    await waitForInstallDelay(publicControlPlanePollIntervalMs);
  }
  throw new Error(
    `Public Compartment control plane at ${apiUrl} was not ready after 300s: ${lastFailure}. Check DNS, ports 80/443, and the TLS certificate status, then re-run install to resume.`,
  );
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
