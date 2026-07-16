import type { InstallResponse } from '@compartment/contracts';

import type { InstallInput } from './install.service.types';
import { createInstallRequester } from './context.service';
import { installCompartment } from '@compartment/sdk';

export async function install(apiUrl: string, installToken: string, input: InstallInput): Promise<InstallResponse> {
  const { adminEmail, adminPassword, baseDomain, organizationName, organizationSlug }: InstallInput = input;
  return await installCompartment(createInstallRequester(apiUrl, installToken), {
    adminEmail,
    adminPassword,
    baseDomain,
    organizationName,
    organizationSlug,
  });
}
