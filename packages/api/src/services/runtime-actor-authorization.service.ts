import { createForbiddenError } from '../errors/api-business-error';
import { findOrganizationPrincipalAccessById } from '../queries/organization-users.query';
import type { OrganizationPrincipalAccessRow } from '../queries/organization-users.query.types';
import { findActiveSourceByAutomationPrincipal } from '../queries/source.query';
import type { SourceRow } from '../queries/source.query.types';

interface ActiveHumanRuntimeActorInput {
  organizationId: string;
  principalId: string;
}

interface ActiveSourceAutomationRuntimeActorInput extends ActiveHumanRuntimeActorInput {
  sourceId: string;
}

export async function requireActiveHumanRuntimeActor(input: ActiveHumanRuntimeActorInput): Promise<void> {
  const principal: OrganizationPrincipalAccessRow | undefined = await findOrganizationPrincipalAccessById(
    input.organizationId,
    input.principalId,
  );
  if (principal === undefined || !isActiveHumanRuntimePrincipal(principal)) {
    throw createForbiddenError();
  }
}

export async function requireActiveSourceAutomationRuntimeActor(
  input: ActiveSourceAutomationRuntimeActorInput,
): Promise<SourceRow> {
  const principal: OrganizationPrincipalAccessRow | undefined = await findOrganizationPrincipalAccessById(
    input.organizationId,
    input.principalId,
  );
  if (principal === undefined || !isActiveSourceAutomationPrincipal(principal)) {
    throw createForbiddenError();
  }

  const source: SourceRow | undefined = await findActiveSourceByAutomationPrincipal({
    organizationId: input.organizationId,
    principalId: input.principalId,
    sourceId: input.sourceId,
  });
  if (source === undefined) {
    throw createForbiddenError();
  }

  return source;
}

function isActiveHumanRuntimePrincipal(principal: OrganizationPrincipalAccessRow): boolean {
  return (
    principal.principalType === 'user' &&
    principal.blockedAt === null &&
    (principal.passwordHash !== null || principal.hasSsoOidcIdentity)
  );
}

function isActiveSourceAutomationPrincipal(principal: OrganizationPrincipalAccessRow): boolean {
  return principal.principalType === 'automation' && principal.blockedAt === null;
}
