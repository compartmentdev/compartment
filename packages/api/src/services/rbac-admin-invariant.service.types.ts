import type { PermissionKey } from '@compartment/contracts';
import type { AccessAssignmentScopeTypeValue, RbacTransaction } from '../queries/rbac.query.types';

export interface OrganizationAccessMutationTransactionInput<TResult> {
  mutation: (tx: RbacTransaction) => Promise<TResult>;
  organizationId: string;
}

export interface PrincipalScopedOrganizationAccessMutationTransactionInput<
  TResult,
> extends OrganizationAccessMutationTransactionInput<TResult> {
  principalId: string;
}

export interface RbacGrantablePermissionsInput {
  actorPrincipalId: string;
  organizationId: string;
  permissionKeys: readonly PermissionKey[];
  scope: RbacGrantablePermissionsScope;
}

export interface RbacGrantablePermissionSetsInput {
  actorPrincipalId: string;
  organizationId: string;
  permissionSets: RbacGrantablePermissionSet[];
}

export interface RbacGrantablePermissionSet {
  permissionKeys: readonly PermissionKey[];
  scope: RbacGrantablePermissionsScope;
}

export interface RbacGrantablePermissionsScope {
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}
