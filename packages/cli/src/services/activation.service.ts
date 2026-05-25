import type { ActivateRequest, ActivateResponse } from '@compartment/contracts';
import { activateCompartment } from '@compartment/sdk';
import { createApiRequester } from './context.service';
import type { ApiContext } from './context.types';

export async function activate(context: ApiContext, input: ActivateRequest): Promise<ActivateResponse> {
  return await activateCompartment(createApiRequester(context.apiUrl), input);
}
