import type { InstallResponse } from '@compartment/contracts';
import { isCompartmentRequestError } from '@compartment/sdk';
import { readCompartmentDevInstallContext } from './repo-root';
import type { CompartmentDevInstallContext } from './repo-root.types';
import type { CliInstallResult } from './install.types';
import { install } from './services/install.service';
import type { InstallInput } from './services/install.service.types';

export async function installDev(input: Omit<InstallInput, 'baseDomain'>): Promise<CliInstallResult> {
  const context: CompartmentDevInstallContext = await readCompartmentDevInstallContext();
  return await installAgainstApi(context.apiUrl, context.installToken, { ...input, baseDomain: 'localhost' });
}

export async function installKubernetesOwner(
  apiUrl: string,
  installToken: string,
  input: InstallInput,
): Promise<CliInstallResult> {
  try {
    return await installAgainstApi(apiUrl, installToken, input);
  } catch (error) {
    throw createOwnerInstallError(error instanceof Error ? error : new Error('Unknown owner creation failure.'));
  }
}

function createOwnerInstallError(error: Error): Error {
  if (isCompartmentRequestError(error)) {
    const requestId: string = error.requestId === undefined ? '' : ` (request-id: ${error.requestId})`;
    const advice: string =
      error.statusCode >= 500 || error.statusCode === 429
        ? 'This request was not retried because owner creation may already have completed. Try logging in; if no owner exists, re-run install to resume.'
        : 'Check the owner and organization settings, then re-run install.';
    return new Error(
      `Creating owner: ${error.method} ${error.url} failed with status ${error.statusCode.toString()}${requestId}. ${advice}`,
    );
  }
  return new Error(
    `Creating owner failed: ${error.message} This request was not retried because owner creation may already have completed. Try logging in; if no owner exists, re-run install to resume.`,
  );
}

async function installAgainstApi(apiUrl: string, installToken: string, input: InstallInput): Promise<CliInstallResult> {
  const response: InstallResponse = await install(apiUrl, installToken, input);

  return {
    ...response,
    apiUrl,
  };
}
