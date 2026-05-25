import type { AddAccessGroupMemberRequest } from '@compartment/contracts';

export interface AddOrganizationAccessGroupMemberInput {
  actorPrincipalId: string;
  groupId: string;
  organizationId: string;
  request: AddAccessGroupMemberRequest;
}

export interface AccessGroupResult {
  assignmentCount: number;
  description: string | null;
  id: string;
  memberCount: number;
  name: string;
}

export interface AccessGroupListRowResult extends AccessGroupResult {
  assignedRoleNames: string[];
  assignmentScopeLabels: string[];
}

export interface AccessGroupMemberResult {
  email: string;
  id: string;
  status: 'active' | 'invited';
}

export interface AccessGroupMemberMutationResult {
  changed: boolean;
  members: AccessGroupMemberResult[];
}
