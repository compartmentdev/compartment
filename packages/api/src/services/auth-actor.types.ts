import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';

interface ActorMembershipSnapshot {
  role: string;
  scopeId: string;
  scopeType: 'environment' | 'organization' | 'project';
}

export interface Actor {
  authSession: AuthSessionOrganizationPolicySession;
  memberships?: readonly ActorMembershipSnapshot[] | undefined;
  principalEmail: string;
  principalId: string;
  principalType: 'user';
  sessionId: string;
  tokenHash: string;
}
