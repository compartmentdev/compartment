import { createOrganizationMembership, createPrincipalWithType } from '../../queries/principals.query';
import { updateSourceAutomationPrincipal } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import {
  lockOrganizationMembershipMutationWithExecutor,
  updateOrganizationMembershipBlockWithExecutor,
} from '../../queries/organization-membership-mutations.query';
import { getApiDatabase } from '../../runtime/runtime-access';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../rbac-seed.service';
import { assertOrganizationAccessMutationInvariantWithExecutor } from '../rbac-admin-invariant.service';
import {
  buildSourceAutomationMembershipId,
  buildSourceAutomationPrincipalEmail,
  buildSourceAutomationPrincipalId,
} from './git-source-resolution-worker.support';

export async function ensureSourceAutomationPrincipal(source: SourceRow): Promise<string> {
  return await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<string> =>
      await ensureSourceAutomationPrincipalWithExecutor(transaction, source),
  );
}

export async function ensureSourceAutomationPrincipalWithExecutor(
  transaction: SourceMutationTransaction,
  source: SourceRow,
): Promise<string> {
  const principalId: string = source.automationPrincipalId ?? buildSourceAutomationPrincipalId(source.id);
  const now: Date = new Date();
  await ensureSourceAutomationPrincipalAccess(transaction, source, principalId);
  if (source.automationPrincipalId !== principalId) {
    await updateSourceAutomationPrincipal(transaction, {
      automationPrincipalId: principalId,
      sourceId: source.id,
      updatedAt: now,
    });
  }
  return principalId;
}

async function ensureSourceAutomationPrincipalAccess(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  principalId: string,
): Promise<void> {
  await createPrincipalWithType(transaction, {
    email: buildSourceAutomationPrincipalEmail(source.id),
    id: principalId,
    type: 'automation',
  });
  await createOrganizationMembership(transaction, {
    id: buildSourceAutomationMembershipId(source.id),
    organizationId: source.organizationId,
    principalId,
  });
  await assignOrganizationSystemRoleToPrincipalWithExecutor(
    transaction,
    source.organizationId,
    principalId,
    'deployer',
  );
}

export async function blockSourceAutomationPrincipalAccessWithExecutor(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  now: Date,
): Promise<void> {
  if (source.automationPrincipalId === null) {
    return;
  }

  await lockOrganizationMembershipMutationWithExecutor(transaction, source.organizationId);
  await updateOrganizationMembershipBlockWithExecutor(transaction, {
    blockedAt: now,
    organizationId: source.organizationId,
    principalId: source.automationPrincipalId,
  });
  await assertOrganizationAccessMutationInvariantWithExecutor(transaction, source.organizationId);
}
