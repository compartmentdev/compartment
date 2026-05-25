import {
  buildFastifyResponseSchemas,
  compartmentWhoAmIPathname,
  findOrganizationBySlug,
  whoamiQuerySchema,
  type FastifyResponseSchemas,
  whoamiResponseSchema,
  type OrganizationSummary,
  type WhoAmIQuery,
  type WhoAmIResponse,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { getCurrentOrganizationHeaderValue } from '../../http/headers';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { resolveInheritedAccess } from '../../services/access-scope.service';
import type { EffectiveAccess } from '../../services/access-scope.service.types';
import { resolveExistingEnvironmentContext } from '../../services/deployment-context.service';
import type { ResolvedEnvironmentContext } from '../../services/deployments.service.types';
import { listSessionVisibleOrganizations } from '../../services/organizations.service';
import { buildOrganizationSummaries } from '../presenters/organization.presenter';
import { buildPrincipalSummary } from '../presenters/principal.presenter';

interface WhoAmIRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerGetWhoAmIRoute(app: ApiApp): void {
  app.get(compartmentWhoAmIPathname, whoAmIRouteOptions, handleGetWhoAmI);
}

const whoAmIRouteOptions: WhoAmIRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: whoamiResponseSchema,
    }),
  },
};

async function handleGetWhoAmI(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: WhoAmIQuery = parseRequestValue(whoamiQuerySchema, request.query, 'invalid_whoami_query');
  const currentOrganizationSlug: string | undefined = getCurrentOrganizationHeaderValue(request.headers);
  const organizationsForPrincipal: OrganizationSummary[] = buildOrganizationSummaries(
    await listSessionVisibleOrganizations(request.actor.authSession),
  );
  const currentOrganization: OrganizationSummary | null = hasText(currentOrganizationSlug)
    ? findOrganizationBySlug(organizationsForPrincipal, currentOrganizationSlug)
    : null;
  const access: EffectiveAccess | null = await readCurrentOrganizationAccess(request, currentOrganization, query);
  const response: WhoAmIResponse = whoamiResponseSchema.parse({
    currentOrganization,
    currentOrganizationPermissions: access?.permissions ?? [],
    principal: buildPrincipalSummary({
      email: request.actor.principalEmail,
      id: request.actor.principalId,
      type: request.actor.principalType,
    }),
  });

  return await reply.send(response);
}

async function readCurrentOrganizationAccess(
  request: FastifyRequest,
  currentOrganization: OrganizationSummary | null,
  query: Readonly<WhoAmIQuery>,
): Promise<EffectiveAccess | null> {
  if (currentOrganization === null) {
    return null;
  }

  const routeScope: { scopeId: string; scopeType: 'environment' | 'organization' } =
    query.projectName !== undefined && query.environmentName !== undefined
      ? await readEnvironmentRouteScope(request, currentOrganization, {
          environmentName: query.environmentName,
          projectName: query.projectName,
        })
      : {
          scopeId: currentOrganization.id,
          scopeType: 'organization',
        };

  return await resolveInheritedAccess({
    organizationId: currentOrganization.id,
    principalId: request.actor.principalId,
    routeScope,
  });
}

async function readEnvironmentRouteScope(
  request: FastifyRequest,
  currentOrganization: OrganizationSummary,
  query: Readonly<WhoAmIQuery> & { environmentName: string; projectName: string },
): Promise<{ scopeId: string; scopeType: 'environment' }> {
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    request.actor.principalId,
    currentOrganization.slug,
    query.projectName,
    query.environmentName,
    'deployment.read',
  );

  return {
    scopeId: environmentContext.environment.id,
    scopeType: 'environment',
  };
}
