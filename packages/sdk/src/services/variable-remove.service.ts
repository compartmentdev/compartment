import {
  removeVariableResponseSchema,
  type RemoveVariableResponse,
  type VariableTargetQuery,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildVariableItemPath } from './variable-path.service';

export async function removeVariable(
  request: CompartmentRequester,
  keyName: string,
  query: VariableTargetQuery,
): Promise<RemoveVariableResponse> {
  return await request<RemoveVariableResponse, undefined>({
    method: 'DELETE',
    path: buildVariableItemPath(keyName, query),
    schema: removeVariableResponseSchema,
  });
}
