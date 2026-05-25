import { variableResponseSchema, type VariableResponse, type VariableTargetQuery } from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildVariableItemPath } from './variable-path.service';

export async function getVariable(
  request: CompartmentRequester,
  keyName: string,
  query: VariableTargetQuery,
): Promise<VariableResponse> {
  return await request<VariableResponse, undefined>({
    method: 'GET',
    path: buildVariableItemPath(keyName, query),
    schema: variableResponseSchema,
  });
}
