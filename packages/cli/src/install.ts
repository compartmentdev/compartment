import type { InstallResponse } from '@compartment/contracts';
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
  return await installAgainstApi(apiUrl, installToken, input);
}

async function installAgainstApi(apiUrl: string, installToken: string, input: InstallInput): Promise<CliInstallResult> {
  const response: InstallResponse = await install(apiUrl, installToken, input);

  return {
    ...response,
    apiUrl,
  };
}
