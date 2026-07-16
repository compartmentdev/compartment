import type { InstallResponse } from '@compartment/contracts';
import { readCompartmentDevApiUrl } from './repo-root';
import type { DevInstallResult } from './install.types';
import { install } from './services/install.service';
import type { InstallInput } from './services/install.service.types';

export async function installDev(input: Omit<InstallInput, 'baseDomain'>): Promise<DevInstallResult> {
  const apiUrl: string = await readCompartmentDevApiUrl();
  const response: InstallResponse = await install(
    {
      apiUrl,
    },
    {
      ...input,
      baseDomain: 'localhost',
    },
  );

  return {
    ...response,
    apiUrl,
    configDir: process.cwd(),
    dataDir: process.cwd(),
  };
}
