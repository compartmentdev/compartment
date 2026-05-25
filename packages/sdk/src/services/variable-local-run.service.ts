import {
  compartmentVariableLocalRunPathname,
  variableLocalRunRequestSchema,
  variableLocalRunResponseSchema,
  type VariableLocalRunRequest,
  type VariableLocalRunResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function loadVariablesForLocalRun(
  request: CompartmentRequester,
  body: VariableLocalRunRequest,
): Promise<VariableLocalRunResponse> {
  return await request<VariableLocalRunResponse, VariableLocalRunRequest>({
    body: variableLocalRunRequestSchema.parse(body),
    method: 'POST',
    path: compartmentVariableLocalRunPathname,
    schema: variableLocalRunResponseSchema,
  });
}
