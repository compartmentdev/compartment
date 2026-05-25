import { setTimeout as delay } from 'node:timers/promises';
import { readDockerCommandErrorText } from './docker-command-error';
import type { DockerCommandResult } from './docker-command.types';

type RegistryCommandRunner = () => Promise<DockerCommandResult>;

const transientDockerRegistryRetryDelayMs: number = 1_000;
const transientDockerRegistryRetryMaxAttempts: number = 3;

export async function runCommandWithTransientRegistryRetry(
  runCommand: RegistryCommandRunner,
): Promise<DockerCommandResult> {
  let lastError: Error | null = null;

  for (let attempt: number = 1; attempt <= transientDockerRegistryRetryMaxAttempts; attempt += 1) {
    try {
      return await runCommand();
    } catch (error) {
      const commandError: Error = error instanceof Error ? error : new Error('Registry command failed.');
      lastError = commandError;
      if (!isTransientDockerRegistryAuthFailure(commandError) || attempt === transientDockerRegistryRetryMaxAttempts) {
        throw commandError;
      }

      await delay(transientDockerRegistryRetryDelayMs);
    }
  }

  throw lastError ?? new Error('Registry command failed after retry.');
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
