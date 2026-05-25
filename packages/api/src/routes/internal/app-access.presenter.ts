import type { AppAccessExchangeResponse } from '@compartment/contracts';
import type { AppAccessExchangeResult } from '../../services/app-access.service.types';

export function buildAppAccessExchangeResponse(result: AppAccessExchangeResult): AppAccessExchangeResponse {
  return {
    appSessionToken: result.appSessionToken,
    redirectPath: result.redirectPath,
    session: {
      authSessionId: result.session.authSessionId,
      expiresAt: result.session.expiresAt.toISOString(),
      host: result.session.host,
      principalEmail: result.session.principalEmail,
      principalId: result.session.principalId,
      principalType: result.session.principalType,
    },
  };
}
