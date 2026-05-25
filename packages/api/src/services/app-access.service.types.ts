import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';

export interface BrowserCompartmentSession {
  authSession: AuthSessionOrganizationPolicySession;
  expiresAt: Date;
  principalEmail: string;
  principalId: string;
  sessionId: string;
  sessionToken: string;
}

export interface AppAccessExchangeSession {
  authSessionId: string;
  expiresAt: Date;
  host: string;
  principalEmail: string;
  principalId: string;
  principalType: 'user';
}

export interface AppAccessExchangeResult {
  appSessionToken: string;
  redirectPath: string;
  session: AppAccessExchangeSession;
}

export interface IssueAppAccessRedirectInput {
  authSessionId: string;
  host: string;
  redirectPath: string;
  state: string;
}

export interface CanIssueAppAccessRedirectInput {
  host: string;
  path: string;
  sessionId: string;
}
