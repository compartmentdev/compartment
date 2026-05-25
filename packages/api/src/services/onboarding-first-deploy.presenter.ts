import type { FirstDeployOnboardingSession } from '@compartment/contracts';
import type { FirstDeployOnboardingSessionRow } from '../queries/onboarding-first-deploy.query.types';

interface FirstDeployOnboardingSessionTimestampFields {
  createdAt: string;
  skippedAt: string | null;
  updatedAt: string;
}

export function toFirstDeployOnboardingSession(
  row: FirstDeployOnboardingSessionRow,
  organizationSlug: string,
): FirstDeployOnboardingSession {
  return {
    ...readSessionTimestampFields(row),
    id: row.id,
    method: row.method,
    organizationSlug,
    state: row.state,
  };
}

function readSessionTimestampFields(row: FirstDeployOnboardingSessionRow): FirstDeployOnboardingSessionTimestampFields {
  return {
    createdAt: row.createdAt.toISOString(),
    skippedAt: row.skippedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
