import { setTimeout as delay } from 'node:timers/promises';
import { connectBuildKitEndpoint } from './buildkit-endpoint-adapter';

const buildKitEndpointMaxAttempts: number = 20;
const buildKitEndpointInitialDelayMs: number = 250;
const buildKitEndpointMaxDelayMs: number = 2_000;

export async function waitForBuildKitEndpoint(address: string): Promise<void> {
  const endpoint: URL = parseBuildKitEndpoint(address);
  let lastError: Error | null = null;

  for (let attempt: number = 1; attempt <= buildKitEndpointMaxAttempts; attempt += 1) {
    try {
      await connectBuildKitEndpoint(endpoint.hostname, Number(endpoint.port));
      return;
    } catch (error) {
      const connectionError: Error = error instanceof Error ? error : new Error('BuildKit endpoint is not ready.');
      lastError = connectionError;
      if (!isTransientBuildKitEndpointError(connectionError) || attempt === buildKitEndpointMaxAttempts) {
        throw connectionError;
      }
      await delay(Math.min(buildKitEndpointInitialDelayMs * 2 ** (attempt - 1), buildKitEndpointMaxDelayMs));
    }
  }

  throw lastError ?? new Error(`BuildKit endpoint ${address} did not become ready.`);
}

export function readBuildKitAddressFromArgs(args: readonly string[]): string | null {
  const addressIndex: number = args.indexOf('--addr');
  const address: string | undefined = addressIndex === -1 ? undefined : args[addressIndex + 1];
  return typeof address === 'string' && address.trim() !== '' ? address : null;
}

function parseBuildKitEndpoint(address: string): URL {
  const endpoint: URL = new URL(address);
  if (endpoint.protocol !== 'tcp:' || endpoint.hostname === '' || endpoint.port === '') {
    throw new Error(`BuildKit endpoint must use tcp://<host>:<port>; received ${address}.`);
  }
  return endpoint;
}

function isTransientBuildKitEndpointError(error: Error): boolean {
  const endpointError: NodeJS.ErrnoException = error;
  return endpointError.code === 'ECONNREFUSED' || endpointError.code === 'ETIMEDOUT';
}
