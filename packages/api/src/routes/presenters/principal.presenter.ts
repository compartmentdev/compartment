import type { PrincipalSummary } from '@compartment/contracts';
import type { PrincipalSummaryInput } from './principal.presenter.types';

export function buildPrincipalSummary(input: PrincipalSummaryInput): PrincipalSummary {
  return {
    email: input.email,
    id: input.id,
    type: input.type,
  };
}
