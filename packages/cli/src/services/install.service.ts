import type { InstallResponse } from '@compartment/contracts';

import type { ApiContext } from './context.types';
import type { InstallInput } from './install.service.types';
import { createApiRequester } from './context.service';
import { installCompartment } from '@compartment/sdk';

export async function install(context: ApiContext, input: InstallInput): Promise<InstallResponse> {
  const { adminEmail, adminPassword, baseDomain, organizationName, organizationSlug }: InstallInput = input;
  return await installCompartment(createApiRequester(context.apiUrl), {
    adminEmail,
    adminPassword,
    baseDomain,
    organizationName,
    organizationSlug,
  });
}
