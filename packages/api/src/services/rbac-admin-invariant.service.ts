import type { PermissionKey } from '@compartment/contracts';
import { createLastOrganizationAdminError } from '../errors/api-business-error';
import { lockOrganizationMembershipMutationWithExecutor } from '../queries/organization-membership-mutations.query';
import { listActiveOrganizationAdminPermissionGrantRowsWithExecutor } from '../queries/organization-memberships.query';
import type { OrganizationAdminPermissionGrantRow } from '../queries/organization-memberships.query.types';
import { lockPrincipalRowWithExecutor } from '../queries/organization-users.query';
import type { RbacTransaction } from '../queries/rbac.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { organizationAdminPathPermissionKeys } from './rbac-admin-path.service';
import type {
  OrganizationAccessMutationTransactionInput,
  PrincipalScopedOrganizationAccessMutationTransactionInput,
} from './rbac-admin-invariant.service.types';

export async function runOrganizationAccessMutationTransaction<TResult>(
  input: OrganizationAccessMutationTransactionInput<TResult>,
): Promise<TResult> {
  return await getApiDatabase().transaction(async (tx: RbacTransaction): Promise<TResult> => {
    await lockOrganizationMembershipMutationWithExecutor(tx, input.organizationId);
    const result: TResult = await input.mutation(tx);
    await assertOrganizationAccessMutationInvariantWithExecutor(tx, input.organizationId);
    return result;
  });
}

export async function runPrincipalScopedOrganizationAccessMutationTransaction<TResult>(
  input: PrincipalScopedOrganizationAccessMutationTransactionInput<TResult>,
): Promise<TResult> {
  return await getApiDatabase().transaction(async (tx: RbacTransaction): Promise<TResult> => {
    await lockPrincipalRowWithExecutor(tx, input.principalId);
    await lockOrganizationMembershipMutationWithExecutor(tx, input.organizationId);
    const result: TResult = await input.mutation(tx);
    await assertOrganizationAccessMutationInvariantWithExecutor(tx, input.organizationId);
    return result;
  });
}

export async function assertOrganizationAccessMutationInvariantWithExecutor(
  tx: RbacTransaction,
  organizationId: string,
): Promise<void> {
  const rows: OrganizationAdminPermissionGrantRow[] = await listActiveOrganizationAdminPermissionGrantRowsWithExecutor(
    tx,
    organizationId,
    organizationAdminPathPermissionKeys,
  );
  const adminPathCount: number = countPrincipalsWithEveryPermission(rows, organizationAdminPathPermissionKeys);
  if (adminPathCount === 0) {
    throw createLastOrganizationAdminError();
  }
}

function countPrincipalsWithEveryPermission(
  rows: readonly OrganizationAdminPermissionGrantRow[],
  requiredPermissionKeys: readonly PermissionKey[],
): number {
  const permissionKeysByPrincipalId: Map<string, Set<PermissionKey>> = new Map<string, Set<PermissionKey>>();
  for (const row of rows) {
    const permissionKeys: Set<PermissionKey> = permissionKeysByPrincipalId.get(row.principalId) ?? new Set();
    permissionKeys.add(row.permissionKey);
    permissionKeysByPrincipalId.set(row.principalId, permissionKeys);
  }

  return [...permissionKeysByPrincipalId.values()].filter((permissionKeys: Set<PermissionKey>): boolean =>
    requiredPermissionKeys.every((permissionKey: PermissionKey): boolean => permissionKeys.has(permissionKey)),
  ).length;
}
