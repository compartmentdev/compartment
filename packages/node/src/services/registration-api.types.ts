import type { NodeRegistrationRequest, NodeRegistrationResponse } from '@compartment/contracts';

export interface CreateRegisterNodeOptions {
  apiUrl: string;
  runtimeControlToken: string;
}

export type RegisterNode = (payload: NodeRegistrationRequest) => Promise<NodeRegistrationResponse>;
