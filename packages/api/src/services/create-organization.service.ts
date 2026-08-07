import { createOrganizationMembershipWithExecutor } from '../queries/organization-memberships.query';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { createOrganizationWithExecutor } from '../queries/organizations.query';
import { createOrganizationQuotaReconciliationWithExecutor } from '../queries/organization-quota-reconciliation.query';
import type {
  CreateOrganizationInput as CreateOrganizationRowInput,
  OrganizationCreationTransaction,
  OrganizationRow,
} from '../queries/organizations.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { getApiDatabase } from '../runtime/runtime-access';
import { createOrganizationSlugTakenError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import type { InsertOperationInput, OperationRecord } from '../queries/operations.query.types';
import type { CreateOrganizationInput, CreateOrganizationResult } from './create-organization.service.types';
import { resolveOrganizationSlug } from './organization-slug.service';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from './rbac-seed.service';

export async function createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  try {
    return await getApiDatabase().transaction(
      async (tx: OrganizationCreationTransaction): Promise<CreateOrganizationResult> =>
        await createOrganizationInTransaction(tx, input),
    );
  } catch (error) {
    if (isUniqueConstraintError(error as Error | undefined)) {
      throw createOrganizationSlugTakenError();
    }

    throw error;
  }
}

async function createOrganizationInTransaction(
  tx: OrganizationCreationTransaction,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const organization: OrganizationRow = await createOrganizationWithExecutor(
    tx,
    buildCreateOrganizationRowInput(input),
  );
  await createOrganizationQuotaReconciliationWithExecutor(tx, organization.id);
  await createOrganizationMembershipWithExecutor(tx, {
    id: createId('mem'),
    organizationId: organization.id,
    principalId: input.principalId,
  });
  await assignOrganizationSystemRoleToPrincipalWithExecutor(tx, organization.id, input.principalId, 'admin');
  const operation: OperationRecord = await insertOperationRecordWithExecutor(
    tx,
    buildCreateOrganizationOperationInput(input.principalId, organization),
  );

  return {
    operation,
    organization,
  };
}

function buildCreateOrganizationRowInput(input: CreateOrganizationInput): CreateOrganizationRowInput {
  return {
    id: createId('org'),
    name: input.name,
    slug: resolveOrganizationSlug(input.name, input.slug),
  };
}

function buildCreateOrganizationOperationInput(
  principalId: string,
  organization: OrganizationRow,
): InsertOperationInput {
  return {
    actorPrincipalId: principalId,
    completedAt: new Date(),
    status: 'succeeded',
    summary: `Created organization ${organization.slug}`,
    targetId: organization.id,
    targetType: 'organization',
    type: 'organization.create',
  };
}
