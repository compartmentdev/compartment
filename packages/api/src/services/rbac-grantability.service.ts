import type { PermissionKey } from '@compartment/contracts';
import { createForbiddenError } from '../errors/api-business-error';
import type { RbacTransaction } from '../queries/rbac.query.types';
import {
  listPrincipalPermissionGrants,
  resolveInheritedAccessFromPrincipalGrants,
  resolveInheritedAccessWithExecutor,
} from './access-scope.service';
import type { EffectiveAccess, PrincipalPermissionGrant } from './access-scope.service.types';
import type {
  RbacGrantablePermissionSet,
  RbacGrantablePermissionSetsInput,
  RbacGrantablePermissionsInput,
} from './rbac-admin-invariant.service.types';

export async function assertPrincipalCanGrantPermissionsWithExecutor(
  tx: RbacTransaction,
  input: RbacGrantablePermissionsInput,
): Promise<void> {
  const access: EffectiveAccess | null = await resolveInheritedAccessWithExecutor(
    {
      organizationId: input.organizationId,
      principalId: input.actorPrincipalId,
      routeScope: input.scope,
    },
    tx,
  );

  assertEveryPermissionIsGrantable(access, input.permissionKeys);
}

export async function assertPrincipalCanGrantPermissionSetsWithExecutor(
  tx: RbacTransaction,
  input: RbacGrantablePermissionSetsInput,
): Promise<void> {
  const grants: PrincipalPermissionGrant[] = await listPrincipalPermissionGrants(
    input.organizationId,
    input.actorPrincipalId,
    tx,
  );
  for (const permissionSet of input.permissionSets) {
    await assertPrincipalCanGrantPermissionSet(input, permissionSet, grants);
  }
}

async function assertPrincipalCanGrantPermissionSet(
  input: Pick<RbacGrantablePermissionSetsInput, 'actorPrincipalId' | 'organizationId'>,
  permissionSet: RbacGrantablePermissionSet,
  grants: PrincipalPermissionGrant[],
): Promise<void> {
  const access: EffectiveAccess | null = await resolveInheritedAccessFromPrincipalGrants(
    {
      organizationId: input.organizationId,
      principalId: input.actorPrincipalId,
      routeScope: permissionSet.scope,
    },
    grants,
  );

  assertEveryPermissionIsGrantable(access, permissionSet.permissionKeys);
}

function assertEveryPermissionIsGrantable(
  access: EffectiveAccess | null,
  permissionKeys: readonly PermissionKey[],
): void {
  const grantablePermissionKeys: ReadonlySet<PermissionKey> = new Set<PermissionKey>(access?.permissions ?? []);
  if (permissionKeys.every((permissionKey: PermissionKey): boolean => grantablePermissionKeys.has(permissionKey))) {
    return;
  }

  throw createForbiddenError();
}
