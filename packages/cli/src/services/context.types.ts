import type { CliOrganizationConfig } from '../store/config.types';

export interface ApiContext {
  apiUrl: string;
}

export interface AuthenticatedContext extends ApiContext {
  currentOrganization?: CliOrganizationConfig | undefined;
  firstDeployOnboardingSessionId?: string | undefined;
  remoteName: string;
  sessionToken: string;
}

export interface CreateAuthenticatedClientOptions {
  includeCurrentOrganization: boolean;
  requestTimeoutMs?: number | null | undefined;
}
