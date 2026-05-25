import {
  compartmentInstallPathname,
  installResponseSchema,
  type InstallRequest,
  type InstallResponse,
} from '@compartment/contracts';

import type { CompartmentRequester } from '../http/request.types';

export async function installCompartment(
  request: CompartmentRequester,
  body: InstallRequest,
): Promise<InstallResponse> {
  return await request<InstallResponse, InstallRequest>({
    body,
    method: 'POST',
    path: compartmentInstallPathname,
    schema: installResponseSchema,
  });
}
