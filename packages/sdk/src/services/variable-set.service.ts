import {
  compartmentVariablesPathname,
  setVariableRequestSchema,
  variableResponseSchema,
  type SetVariableRequest,
  type VariableResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function setVariable(request: CompartmentRequester, body: SetVariableRequest): Promise<VariableResponse> {
  return await request<VariableResponse, SetVariableRequest>({
    body: setVariableRequestSchema.parse(body),
    method: 'POST',
    path: compartmentVariablesPathname,
    schema: variableResponseSchema,
  });
}
