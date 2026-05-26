import { resolveRuntimeContainerNetworkHost } from './runtime-resource-connectivity.service';

const resourceReadinessPollIntervalMs: number = 500;

export async function resolveResourceReadinessHost(containerRef: string, resourceNetworkName: string): Promise<string> {
  return await resolveRuntimeContainerNetworkHost(containerRef, resourceNetworkName);
}

export async function continueResourceReadinessPolling(deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) {
    return false;
  }

  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, resourceReadinessPollIntervalMs);
  });
  return Date.now() < deadline;
}
