import { getApiConfig } from '../runtime/runtime-access';

export function readNullableDeploymentUpstreamHost(
  upstreamHost: string | null,
  upstreamPort: number | null,
): string | null {
  return upstreamPort === null ? null : readDeploymentUpstreamHost(upstreamHost);
}

export function readDeploymentUpstreamHost(upstreamHost: string | null): string {
  return upstreamHost ?? getApiConfig().runtimeDefaultUpstreamHost;
}
