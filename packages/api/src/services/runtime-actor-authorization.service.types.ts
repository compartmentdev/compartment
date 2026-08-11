import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';

export interface ActiveHumanRuntimeActorInput {
  organizationId: string;
  principalId: string;
}

export interface ActiveHumanRuntimeSessionActorInput extends ActiveHumanRuntimeActorInput {
  session: AuthSessionOrganizationPolicySession;
}

export interface ActiveSourceAutomationRuntimeActorInput {
  organizationId: string;
  principalId: string;
  sourceId: string;
}
