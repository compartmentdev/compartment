import type { ApiConfig } from '../config';
import { createCustomDomainCollisionError, createCustomDomainNotFoundError } from '../errors/api-business-error';
import { hashToken } from '../lib/tokens';
import { findCustomDomainByHost, insertCustomDomain } from '../queries/custom-domains.query';
import type { CustomDomainRow, InsertCustomDomainInput } from '../queries/custom-domains.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { buildCompartmentDomainOwnershipValue } from './domain-ownership-dns.service';

export interface CustomDomainInsertTarget {
  environmentId: string;
  organizationId: string;
  serviceId: string;
}

export interface PendingCustomDomainInsert {
  createdByPrincipalId: string;
  domainId: string;
  host: string;
  now: Date;
}

export async function insertCustomDomainForTarget(
  target: CustomDomainInsertTarget,
  pendingDomain: PendingCustomDomainInsert,
  config: ApiConfig,
): Promise<void> {
  try {
    await insertPreparedCustomDomain(target, pendingDomain, config);
  } catch (error) {
    if (!isUniqueConstraintError(error as Error | undefined)) {
      throw error;
    }

    await throwIfCustomDomainAssigned(pendingDomain.host);
    throw createCustomDomainNotFoundError();
  }
}

async function insertPreparedCustomDomain(
  target: CustomDomainInsertTarget,
  pendingDomain: PendingCustomDomainInsert,
  config: ApiConfig,
): Promise<void> {
  await insertCustomDomain(buildInsertCustomDomainInput(target, pendingDomain, config));
}

function buildInsertCustomDomainInput(
  target: CustomDomainInsertTarget,
  pendingDomain: PendingCustomDomainInsert,
  config: ApiConfig,
): InsertCustomDomainInput {
  return {
    createdByPrincipalId: pendingDomain.createdByPrincipalId,
    environmentId: target.environmentId,
    host: pendingDomain.host,
    id: pendingDomain.domainId,
    projectServiceId: target.serviceId,
    updatedAt: pendingDomain.now,
    verificationTokenHash: hashToken(
      buildCompartmentDomainOwnershipValue(pendingDomain.domainId),
      config.sessionSecret,
    ),
  };
}

export async function throwIfCustomDomainAssigned(host: string): Promise<void> {
  const existingDomain: CustomDomainRow | undefined = await findCustomDomainByHost(host);
  if (existingDomain !== undefined) {
    throw createCustomDomainCollisionError(`Custom domain ${host} is already assigned.`);
  }
}
