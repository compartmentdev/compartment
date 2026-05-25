import type { CliLoginExchangeResponse, CliLoginStartResponse, CliLoginStatusResponse } from '@compartment/contracts';
import type {
  CliLoginExchangeResult,
  CliLoginStartResult,
  CliLoginStatusResult,
} from '../../services/cli-login.service.types';
import { buildAuthSessionResponseBaseFields } from './auth-session-response.helpers';

export function buildCliLoginStartResponse(result: CliLoginStartResult): CliLoginStartResponse {
  return {
    attemptId: result.attemptId,
    exchangeSecret: result.exchangeSecret,
    expiresAt: result.expiresAt.toISOString(),
    pollAfterMs: result.pollAfterMs,
    verificationUrl: result.verificationUrl,
  };
}

export function buildCliLoginStatusResponse(result: CliLoginStatusResult): CliLoginStatusResponse {
  return {
    expiresAt: result.expiresAt.toISOString(),
    status: result.status,
  };
}

export function buildCliLoginExchangeResponse(result: CliLoginExchangeResult): CliLoginExchangeResponse {
  return {
    ...buildAuthSessionResponseBaseFields(result.organizations, result.principalEmail, result.principalId),
    sessionToken: result.sessionToken,
  };
}
