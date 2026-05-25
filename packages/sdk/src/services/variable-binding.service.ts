import {
  variableGroupBindingRequestSchema,
  variableGroupBindingResponseSchema,
  type VariableGroupBindingRequest,
  type VariableGroupBindingResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildVariableBindingItemPath } from './variable-path.service';

export async function bindVariableGroup(
  request: CompartmentRequester,
  input: VariableGroupBindingRequest,
): Promise<VariableGroupBindingResponse> {
  const query: VariableGroupBindingRequest = variableGroupBindingRequestSchema.parse(input);

  return await request<VariableGroupBindingResponse, undefined>({
    method: 'POST',
    path: buildVariableBindingItemPath(query),
    schema: variableGroupBindingResponseSchema,
  });
}

export async function unbindVariableGroup(
  request: CompartmentRequester,
  input: VariableGroupBindingRequest,
): Promise<VariableGroupBindingResponse> {
  const query: VariableGroupBindingRequest = variableGroupBindingRequestSchema.parse(input);

  return await request<VariableGroupBindingResponse, undefined>({
    method: 'DELETE',
    path: buildVariableBindingItemPath(query),
    schema: variableGroupBindingResponseSchema,
  });
}
