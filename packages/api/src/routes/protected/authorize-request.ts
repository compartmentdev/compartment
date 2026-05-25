import { type PermissionKey } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { createForbiddenError, createOrganizationNotFoundError } from '../../errors/api-business-error';
import { requireCurrentOrganizationHeaderValue } from '../../http/headers';
import type { CurrentOrganizationAccess } from '../../http/request.types';
import { resolveInheritedAccess } from '../../services/access-scope.service';
import type { EffectiveAccess } from '../../services/access-scope.service.types';
import { isAuthSessionAllowedForOrganization } from '../../services/organization-auth-settings.service';
import { resolveOrganizationForPrincipal } from '../../services/organizations.service';
import type { ResolvedOrganization } from '../../services/organizations.service.types';

export async function requireCurrentOrganizationAccess(
  request: FastifyRequest,
  requiredPermission?: PermissionKey,
): Promise<CurrentOrganizationAccess> {
  const organizationSlug: string = requireCurrentOrganizationHeaderValue(request.headers);
  const organization: ResolvedOrganization | undefined = await resolveOrganizationForPrincipal(
    request.actor.principalId,
    organizationSlug,
  );
  if (organization === undefined) {
    throw createOrganizationNotFoundError();
  }
  await requireCurrentOrganizationSessionVisibility(request, organization);
  if (requiredPermission !== undefined) {
    await requireCurrentOrganizationPermission(request.actor.principalId, organization.id, requiredPermission);
  }

  return {
    id: organization.id,
    slug: organization.slug,
  };
}

async function requireCurrentOrganizationSessionVisibility(
  request: FastifyRequest,
  organization: ResolvedOrganization,
): Promise<void> {
  const sessionAllowedForOrganization: boolean = await isAuthSessionAllowedForOrganization({
    organizationId: organization.id,
    session: request.actor.authSession,
  });
  if (!sessionAllowedForOrganization) {
    throw createOrganizationNotFoundError();
  }
}

async function requireCurrentOrganizationPermission(
  principalId: string,
  organizationId: string,
  requiredPermission: PermissionKey,
): Promise<void> {
  assertCurrentOrganizationPermissionGranted(
    await hasInheritedCurrentOrganizationPermission(principalId, organizationId, requiredPermission),
  );
}

async function hasInheritedCurrentOrganizationPermission(
  principalId: string,
  organizationId: string,
  requiredPermission: PermissionKey,
): Promise<boolean> {
  const access: EffectiveAccess | null = await resolveInheritedAccess({
    organizationId,
    principalId,
    routeScope: {
      scopeId: organizationId,
      scopeType: 'organization',
    },
  });

  return access?.permissions.includes(requiredPermission) === true;
}

function assertCurrentOrganizationPermissionGranted(granted: boolean): void {
  if (!granted) {
    throw createForbiddenError();
  }
}
