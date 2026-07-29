import { setTimeout as delay } from 'node:timers/promises';
import { readDockerCommandErrorText } from './docker-command-error';
import type { DockerCommandResult } from './docker-command.types';

type BuildCommandRunner = () => Promise<DockerCommandResult>;

const transientDockerRegistryRetryDelayMs: number = 1_000;
const transientDockerRegistryRetryMaxAttempts: number = 3;
const transientBuildKitRetryInitialDelayMs: number = 500;
const transientBuildKitRetryMaxAttempts: number = 6;

export async function runCommandWithTransientBuildRetry(
  runCommand: BuildCommandRunner,
  buildKitAddress?: string,
): Promise<DockerCommandResult> {
  let lastError: Error | null = null;

  for (let attempt: number = 1; attempt <= transientBuildKitRetryMaxAttempts; attempt += 1) {
    try {
      return await runCommand();
    } catch (error) {
      const commandError: Error = error instanceof Error ? error : new Error('Build command failed.');
      lastError = commandError;
      const registryFailure: boolean = isTransientDockerRegistryAuthFailure(commandError);
      const buildKitFailure: boolean = isTransientBuildKitConnectionFailure(commandError, buildKitAddress);
      if (!shouldRetryBuildCommand(registryFailure, buildKitFailure, attempt)) {
        throw commandError;
      }

      await delay(readBuildCommandRetryDelayMs(registryFailure, attempt));
    }
  }

  throw lastError ?? new Error('Build command failed after retry.');
}

function shouldRetryBuildCommand(registryFailure: boolean, buildKitFailure: boolean, attempt: number): boolean {
  return (
    (registryFailure || buildKitFailure) &&
    (!registryFailure || attempt < transientDockerRegistryRetryMaxAttempts) &&
    attempt < transientBuildKitRetryMaxAttempts
  );
}

function readBuildCommandRetryDelayMs(registryFailure: boolean, attempt: number): number {
  return registryFailure
    ? transientDockerRegistryRetryDelayMs
    : transientBuildKitRetryInitialDelayMs * 2 ** (attempt - 1);
}

function isTransientBuildKitConnectionFailure(error: Error | null | undefined, buildKitAddress?: string): boolean {
  const errorText: string | null = readDockerCommandErrorText(error);
  const endpointPort: string | null = readBuildKitEndpointPort(buildKitAddress);
  if (errorText === null || endpointPort === null) {
    return false;
  }

  return (
    errorText.includes('rpc error: code = unavailable desc = connection error: desc =') &&
    errorText.includes('unavailable') &&
    errorText.includes('error while dialing') &&
    new RegExp(`dial tcp [^\\s"]+:${escapeRegularExpression(endpointPort)}: connect: connection refused`, 'u').test(
      errorText,
    )
  );
}

function readBuildKitEndpointPort(buildKitAddress: string | undefined): string | null {
  if (buildKitAddress === undefined) {
    return null;
  }
  try {
    const endpoint: URL = new URL(buildKitAddress);
    return endpoint.protocol === 'tcp:' && endpoint.port !== '' ? endpoint.port : null;
  } catch {
    return null;
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isTransientDockerRegistryAuthFailure(error: Error | null | undefined): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  const errorText: string | null = readDockerCommandErrorText(error);
  if (errorText === null) {
    return false;
  }

  return (
    errorText.includes('failed to fetch oauth token') &&
    hasDockerHubAuthTokenUrl(errorText) &&
    errorText.includes('500 internal server error')
  );
}

function hasDockerHubAuthTokenUrl(errorText: string): boolean {
  for (const urlMatch of errorText.matchAll(/https?:\/\/[^\s)"'<>]+/gu)) {
    const parsedUrl: URL | null = parseRegistryErrorUrl(urlMatch[0]);
    if (
      parsedUrl?.protocol === 'https:' &&
      parsedUrl.hostname === 'auth.docker.io' &&
      parsedUrl.pathname === '/token'
    ) {
      return true;
    }
  }

  return false;
}

function parseRegistryErrorUrl(value: string): URL | null {
  try {
    return new URL(value.replace(/[),.;:]+$/u, ''));
  } catch {
    return null;
  }
}
