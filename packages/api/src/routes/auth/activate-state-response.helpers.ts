import type { ActivateStateResponse, ActivateUnavailableReason } from '@compartment/contracts';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';

interface BuildActivateStateResponseInput {
  email?: string | undefined;
  flowTarget: BrowserFlowTargetOrNull;
  hasToken: boolean;
  principalEmail?: string | undefined;
  unavailableReason?: ActivateUnavailableReason | undefined;
}

export function buildActivateStateResponse(input: BuildActivateStateResponseInput): ActivateStateResponse {
  return {
    ...(input.email !== undefined ? { email: input.email } : {}),
    flowTarget: input.flowTarget,
    hasToken: input.hasToken,
    ...(input.principalEmail !== undefined ? { principalEmail: input.principalEmail } : {}),
    ...(input.unavailableReason !== undefined ? { unavailableReason: input.unavailableReason } : {}),
  };
}
