import { createOnboardingSessionNotFoundError } from '../errors/api-business-error';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail } from './onboarding-first-deploy-correlation.service';

export async function readValidatedCliLoginOnboardingSessionId(
  onboardingSessionId: string | undefined,
  principalEmail: string | undefined,
  organization: OrganizationRow | undefined,
): Promise<string | null> {
  if (onboardingSessionId === undefined) {
    return null;
  }
  if (organization === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  return await readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail({
    onboardingSessionId,
    organizationId: organization.id,
    principalEmail,
  });
}
