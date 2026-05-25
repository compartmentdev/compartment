import { createCompartmentRequester, registerNode, type CompartmentRequester } from '@compartment/sdk';
import type { CreateRegisterNodeOptions, RegisterNode } from './registration-api.types';

export function createRegisterNode({ apiUrl, runtimeControlToken }: CreateRegisterNodeOptions): RegisterNode {
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl,
    internalToken: runtimeControlToken,
  });

  return registerNode.bind(null, request);
}
