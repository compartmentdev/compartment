import type { PermissionKey } from '@compartment/contracts';
import type { RbacTransaction } from '../queries/rbac.query.types';
import { assertPrincipalCanGrantPermissionsWithExecutor } from './rbac-grantability.service';

export async function assertCanGrantOrganizationRolePermissions(
  tx: RbacTransaction,
  input: { actorPrincipalId: string; organizationId: string },
  permissionKeys: readonly PermissionKey[],
): Promise<void> {
  await assertPrincipalCanGrantPermissionsWithExecutor(tx, {
    actorPrincipalId: input.actorPrincipalId,
    organizationId: input.organizationId,
    permissionKeys,
    scope: { scopeId: input.organizationId, scopeType: 'organization' },
  });
}
