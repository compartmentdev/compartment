import {
  listCompartmentRolePermissions,
  type CompartmentMembershipRole,
  type PermissionKey,
} from '@compartment/contracts';
import { count, sql } from 'drizzle-orm';
import {
  accessAssignments,
  accessRolePermissions,
  accessRoles,
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
} from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { createAuthSessionWithExecutor } from './authentication.query';
import { insertOperationRecordWithExecutor } from './operations.query';
import type {
  CreateInitialInstallationInput,
  InstallGuardCallback,
  InstallInstallationCountRow,
  InstallReadExecutor,
  InstallTransaction,
} from './install.query.types';
import type { InsertOperationInput, OperationRecord } from './operations.query.types';

const compartmentInstallLockNamespace: number = 1_001;
const compartmentInstallLockKey: number = 1;

export async function withInitialInstallationGuard<TResult>(
  callback: InstallGuardCallback<TResult>,
): Promise<TResult | null> {
  return await getApiDatabase().transaction(async (tx: InstallTransaction): Promise<TResult | null> => {
    await acquireCompartmentInstallLock(tx);
    const installationsCount: number = await countInstallationsInTransaction(tx);

    if (installationsCount > 0) {
      return null;
    }

    return await callback(tx);
  });
}

export async function hasCompletedInstallation(): Promise<boolean> {
  return (await countInstallations(getApiDatabase())) > 0;
}

export async function insertInitialInstallationWithExecutor(
  tx: InstallTransaction,
  input: CreateInitialInstallationInput,
  operationInput: InsertOperationInput,
): Promise<OperationRecord> {
  await insertOrganization(tx, input);
  await insertPrincipal(tx, input);
  await insertOrganizationMembership(tx, input);
  const adminRoleId: string = await insertSystemRoles(tx, input.organizationId);
  await insertAdminAssignment(tx, input, adminRoleId);
  await insertInitialCredentials(tx, input);
  await insertInitialSession(tx, input);

  return await insertOperationRecordWithExecutor(tx, operationInput);
}

async function acquireCompartmentInstallLock(tx: InstallTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${compartmentInstallLockNamespace}, ${compartmentInstallLockKey})`);
}

async function countInstallationsInTransaction(tx: InstallTransaction): Promise<number> {
  return await countInstallations(tx);
}

async function countInstallations(executor: InstallReadExecutor): Promise<number> {
  const existingInstallations: InstallInstallationCountRow[] = await executor
    .select({ value: count() })
    .from(organizations);

  return existingInstallations[0]?.value ?? 0;
}

async function insertOrganization(tx: InstallTransaction, input: CreateInitialInstallationInput): Promise<void> {
  await tx.insert(organizations).values({
    id: input.organizationId,
    name: input.organizationName,
    slug: input.organizationSlug,
  });
}

async function insertPrincipal(tx: InstallTransaction, input: CreateInitialInstallationInput): Promise<void> {
  await tx.insert(principals).values({
    email: input.principalEmail,
    id: input.principalId,
    type: 'user',
  });
}

async function insertOrganizationMembership(
  tx: InstallTransaction,
  input: CreateInitialInstallationInput,
): Promise<void> {
  await tx.insert(organizationMemberships).values({
    id: input.organizationMembershipId,
    organizationId: input.organizationId,
    principalId: input.principalId,
  });
}

async function insertInitialCredentials(tx: InstallTransaction, input: CreateInitialInstallationInput): Promise<void> {
  await tx.insert(localCredentials).values({
    passwordHash: input.passwordHash,
    principalId: input.principalId,
    updatedAt: new Date(),
  });
}

async function insertInitialSession(tx: InstallTransaction, input: CreateInitialInstallationInput): Promise<void> {
  await createAuthSessionWithExecutor(tx, {
    authMethodKind: 'password',
    expiresAt: input.sessionExpiresAt,
    oidcProviderId: null,
    organizationId: input.organizationId,
    principalId: input.principalId,
    sessionId: input.sessionId,
    tokenHash: input.sessionTokenHash,
  });
}

async function insertSystemRoles(tx: InstallTransaction, organizationId: string): Promise<string> {
  let adminRoleId: string | null = null;
  for (const roleName of systemRoleNames) {
    adminRoleId = readNextAdminRoleId(adminRoleId, roleName, await insertSystemRole(tx, organizationId, roleName));
  }

  return requireAdminRoleId(adminRoleId);
}

async function insertAdminAssignment(
  tx: InstallTransaction,
  input: CreateInitialInstallationInput,
  adminRoleId: string,
): Promise<void> {
  await tx.insert(accessAssignments).values({
    id: input.adminAssignmentId,
    organizationId: input.organizationId,
    roleId: adminRoleId,
    scopeId: input.organizationId,
    scopeType: 'organization',
    subjectId: input.principalId,
    subjectType: 'principal',
  });
}

const systemRoleNames: readonly CompartmentMembershipRole[] = ['admin', 'deployer', 'readonly', 'viewer'];

function requireAdminRoleId(adminRoleId: string | null): string {
  if (adminRoleId === null) {
    throw new Error('Expected seeded admin role id.');
  }

  return adminRoleId;
}

async function insertSystemRole(
  tx: InstallTransaction,
  organizationId: string,
  roleName: CompartmentMembershipRole,
): Promise<string> {
  const roleId: string = createId('rol');

  await tx.insert(accessRoles).values({
    id: roleId,
    kind: 'system',
    name: roleName,
    organizationId,
    updatedAt: new Date(),
  });
  await insertSystemRolePermissions(tx, roleId, roleName);

  return roleId;
}

async function insertSystemRolePermissions(
  tx: InstallTransaction,
  roleId: string,
  roleName: CompartmentMembershipRole,
): Promise<void> {
  await tx.insert(accessRolePermissions).values(
    listCompartmentRolePermissions(roleName).map(
      (permissionKey: PermissionKey): typeof accessRolePermissions.$inferInsert => ({
        id: `${roleId}:${permissionKey}`,
        permissionKey,
        roleId,
      }),
    ),
  );
}

function readNextAdminRoleId(
  currentAdminRoleId: string | null,
  roleName: CompartmentMembershipRole,
  roleId: string,
): string | null {
  return roleName === 'admin' ? roleId : currentAdminRoleId;
}
