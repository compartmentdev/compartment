import { resolveRuntimeContainerNetworkHost } from './runtime-resource-connectivity.service';

export const resourceReadinessPollIntervalMs: number = 500;

export async function resolveResourceReadinessHost(containerRef: string, resourceNetworkName: string): Promise<string> {
  return await resolveRuntimeContainerNetworkHost(containerRef, resourceNetworkName);
}
