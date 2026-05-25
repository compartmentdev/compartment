import type { AuthTokenStateResponse } from '@compartment/contracts';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';

interface BuildAuthTokenStateResponseInput {
  email?: string | undefined;
  flowTarget: BrowserFlowTargetOrNull;
  hasToken: boolean;
  principalEmail?: string | undefined;
}

export function buildAuthTokenStateResponse(input: BuildAuthTokenStateResponseInput): AuthTokenStateResponse {
  return {
    ...(input.email !== undefined ? { email: input.email } : {}),
    flowTarget: input.flowTarget,
    hasToken: input.hasToken,
    ...(input.principalEmail !== undefined ? { principalEmail: input.principalEmail } : {}),
  };
}
