import type { ResolvedServiceReadinessConfig } from '@compartment/contracts';

const deploymentHealthPollIntervalMs: number = 500;

type RuntimeHealthHost = string | (() => Promise<string>);

interface RuntimeHealthOptions {
  hostHeader?: string | undefined;
}

export async function waitForHealthyRuntime(
  host: RuntimeHealthHost,
  hostPort: number,
  readiness: ResolvedServiceReadinessConfig,
  options: RuntimeHealthOptions = {},
): Promise<void> {
  const deadline: number = Date.now() + readiness.timeoutMs;

  while (Date.now() <= deadline) {
    const resolvedHost: string | null = await resolveRuntimeHealthHost(host);
    if (resolvedHost !== null && (await isHealthy(resolvedHost, hostPort, readiness, deadline, options))) {
      return;
    }

    await waitForHealthPoll();
  }

  throw new Error(`Container on port ${hostPort} did not become healthy before ${readiness.timeoutMs}ms.`);
}

async function isHealthy(
  host: string,
  hostPort: number,
  readiness: ResolvedServiceReadinessConfig,
  deadline: number,
  options: RuntimeHealthOptions,
): Promise<boolean> {
  try {
    const response: Response = await fetch(
      `http://${host}:${hostPort}${toHttpReadinessPath(readiness.path)}`,
      createRuntimeHealthRequestInit(options, hostPort, deadline),
    );
    return response.ok;
  } catch {
    return false;
  }
}

function createRuntimeHealthRequestInit(
  options: RuntimeHealthOptions,
  hostPort: number,
  deadline: number,
): RequestInit {
  const signal: AbortSignal = AbortSignal.timeout(readHealthRequestTimeoutMs(deadline));
  const headers: Record<string, string> | undefined = createRuntimeHealthHeaders(options, hostPort);
  return headers === undefined ? { signal } : { headers, signal };
}

async function resolveRuntimeHealthHost(host: RuntimeHealthHost): Promise<string | null> {
  try {
    return typeof host === 'string' ? host : await host();
  } catch {
    return null;
  }
}

function createRuntimeHealthHeaders(
  options: RuntimeHealthOptions,
  hostPort: number,
): Record<string, string> | undefined {
  if (options.hostHeader === undefined) {
    return undefined;
  }

  return {
    Host: `${options.hostHeader}:${hostPort}`,
  };
}

function readHealthRequestTimeoutMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function toHttpReadinessPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function waitForHealthPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, deploymentHealthPollIntervalMs);
  });
}
