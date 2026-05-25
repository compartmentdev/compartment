import type { ActivateRequest } from '@compartment/contracts';
import type { ResolvedAuthSessionDelivery } from './auth-token-input.helpers';

export interface ReadActivateRequestResult {
  browserFlowId: string | undefined;
  requestBody: ActivateRequest;
  sessionDelivery: ResolvedAuthSessionDelivery;
}
