import {
  compartmentInternalNodeRegistrationPathname,
  nodeRegistrationResponseSchema,
  type NodeRegistrationRequest,
  type NodeRegistrationResponse,
} from '@compartment/contracts';

import type { CompartmentRequester } from '../http/request.types';

export async function registerNode(
  request: CompartmentRequester,
  body: NodeRegistrationRequest,
): Promise<NodeRegistrationResponse> {
  return await request<NodeRegistrationResponse, NodeRegistrationRequest>({
    body,
    method: 'POST',
    path: compartmentInternalNodeRegistrationPathname,
    schema: nodeRegistrationResponseSchema,
  });
}
