import {
  variableListResponseSchema,
  type VariableListResponse,
  type VariableTargetQuery,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildVariableCollectionPath } from './variable-path.service';

export async function listVariables(
  request: CompartmentRequester,
  query: VariableTargetQuery,
): Promise<VariableListResponse> {
  return await request<VariableListResponse, undefined>({
    method: 'GET',
    path: buildVariableCollectionPath(query),
    schema: variableListResponseSchema,
  });
}
