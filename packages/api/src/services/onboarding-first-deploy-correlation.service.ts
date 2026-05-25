import { createOnboardingSessionNotFoundError } from '../errors/api-business-error';
import { findFirstDeployOnboardingSessionForPrincipal } from '../queries/onboarding-first-deploy.query';
import type { FirstDeployOnboardingSessionRow } from '../queries/onboarding-first-deploy.query.types';
import { findPrincipalIdByEmail } from '../queries/principal.query';

interface FirstDeployOnboardingSessionLookupInput {
  actorPrincipalId: string;
  organizationId: string;
  sessionId: string;
}

interface OptionalFirstDeployOnboardingSessionLookupInput {
  actorPrincipalId: string;
  onboardingSessionId?: string | undefined;
  organizationId: string;
}

interface OptionalFirstDeployOnboardingSessionPrincipalEmailLookupInput {
  onboardingSessionId?: string | undefined;
  organizationId: string;
  principalEmail?: string | undefined;
}

export async function readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail(
  input: OptionalFirstDeployOnboardingSessionPrincipalEmailLookupInput,
): Promise<string | null> {
  if (input.onboardingSessionId === undefined) {
    return null;
  }
  if (input.principalEmail === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  const actorPrincipalId: string | undefined = await findPrincipalIdByEmail(input.principalEmail);
  if (actorPrincipalId === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  return await readValidatedFirstDeployOnboardingSessionId({
    actorPrincipalId,
    onboardingSessionId: input.onboardingSessionId,
    organizationId: input.organizationId,
  });
}

export async function readValidatedFirstDeployOnboardingSessionId(
  input: OptionalFirstDeployOnboardingSessionLookupInput,
): Promise<string | null> {
  if (input.onboardingSessionId === undefined) {
    return null;
  }

  await requireFirstDeployOnboardingSessionForOrganization({
    actorPrincipalId: input.actorPrincipalId,
    organizationId: input.organizationId,
    sessionId: input.onboardingSessionId,
  });
  return input.onboardingSessionId;
}

async function requireFirstDeployOnboardingSessionForOrganization(
  input: FirstDeployOnboardingSessionLookupInput,
): Promise<FirstDeployOnboardingSessionRow> {
  const session: FirstDeployOnboardingSessionRow | undefined = await findFirstDeployOnboardingSessionForPrincipal(
    input.organizationId,
    input.sessionId,
    input.actorPrincipalId,
  );
  if (session === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  return session;
}
