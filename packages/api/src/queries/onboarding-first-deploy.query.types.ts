import type { onboardingFirstDeploySessions } from '../db/schema';

export type PersistedFirstDeployOnboardingSessionRow = typeof onboardingFirstDeploySessions.$inferSelect;

export type FirstDeployOnboardingSessionMethod = 'cli';
export type FirstDeployOnboardingSessionState = 'active' | 'skipped';

export interface FirstDeployOnboardingSessionRow {
  createdAt: Date;
  createdByPrincipalId: string;
  id: string;
  method: FirstDeployOnboardingSessionMethod | null;
  organizationId: string;
  skippedAt: Date | null;
  state: FirstDeployOnboardingSessionState;
  updatedAt: Date;
}

export interface CreateFirstDeployOnboardingSessionInput {
  createdByPrincipalId: string;
  id: string;
  method?: FirstDeployOnboardingSessionMethod | undefined;
  organizationId: string;
  updatedAt: Date;
}

export interface PatchFirstDeployOnboardingSessionInput {
  method?: FirstDeployOnboardingSessionMethod | undefined;
  skippedAt?: Date | null | undefined;
  state?: FirstDeployOnboardingSessionState | undefined;
  updatedAt: Date;
}
