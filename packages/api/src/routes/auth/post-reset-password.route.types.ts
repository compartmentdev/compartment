import type { ResetPasswordRequest } from '@compartment/contracts';
import type { ResolvedAuthSessionDelivery } from './auth-token-input.helpers';

export interface ReadResetPasswordRequestResult {
  browserFlowId: string | undefined;
  requestBody: ResetPasswordRequest;
  sessionDelivery: ResolvedAuthSessionDelivery;
}
