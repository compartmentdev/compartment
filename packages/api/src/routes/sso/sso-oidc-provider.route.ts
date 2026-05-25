import {
  compartmentSsoOidcProvidersPathname,
  configureSsoOidcProviderRequestSchema,
  deleteSsoOidcProviderResponseSchema,
  ssoOidcProviderListResponseSchema,
  ssoOidcProviderResponseSchema,
  type ConfigureSsoOidcProviderRequest,
  type DeleteSsoOidcProviderResponse,
  type UpdateSsoOidcProviderRequest,
  updateSsoOidcProviderRequestSchema,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import {
  createSsoOidcProvider,
  deleteSsoOidcProvider,
  readSsoOidcProvidersForOrganization,
  updateSsoOidcProvider,
} from '../../services/sso-oidc/sso-oidc-provider.service';
import { buildSsoOidcProviderAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import type {
  CreateSsoOidcProviderInput,
  SsoOidcProviderResult,
  UpdateSsoOidcProviderInput,
} from '../../services/sso-oidc/sso-oidc.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildSsoOidcProviderListResponse, buildSsoOidcProviderResponse } from './sso-oidc.presenter';

interface SsoOidcProviderRouteParams {
  providerId: string;
}

type SsoOidcProviderAuditEventType =
  | 'organization.sso_oidc_provider.created'
  | 'organization.sso_oidc_provider.deleted'
  | 'organization.sso_oidc_provider.updated';

const ssoOidcProviderRouteParamsSchema: z.ZodType<SsoOidcProviderRouteParams> = z.object({
  providerId: z.string().min(1),
});
const ssoOidcProviderItemRoutePath: string = `${compartmentSsoOidcProvidersPathname}/:providerId`;

export function registerSsoOidcProviderRoutes(app: ApiApp): void {
  registerSsoOidcProviderCollectionRoutes(app);
  registerSsoOidcProviderItemRoutes(app);
}

function registerSsoOidcProviderCollectionRoutes(app: ApiApp): void {
  app.get(
    compartmentSsoOidcProvidersPathname,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', {
      200: ssoOidcProviderListResponseSchema,
    }),
    handleSsoOidcProviderList,
  );

  app.post(
    compartmentSsoOidcProvidersPathname,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', { 200: ssoOidcProviderResponseSchema }),
    handleSsoOidcProviderCreate,
  );
}

function registerSsoOidcProviderItemRoutes(app: ApiApp): void {
  app.patch(
    ssoOidcProviderItemRoutePath,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', { 200: ssoOidcProviderResponseSchema }),
    handleSsoOidcProviderUpdate,
  );

  app.delete(
    ssoOidcProviderItemRoutePath,
    createCurrentOrganizationRouteResponseOptions('organization.auth.manage', {
      200: deleteSsoOidcProviderResponseSchema,
    }),
    handleSsoOidcProviderDelete,
  );
}

async function handleSsoOidcProviderList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const providers: SsoOidcProviderResult[] = await readSsoOidcProvidersForOrganization(request.currentOrganization.id);

  return await reply.send(ssoOidcProviderListResponseSchema.parse(buildSsoOidcProviderListResponse(providers)));
}

async function handleSsoOidcProviderCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ConfigureSsoOidcProviderRequest = readCreateSsoOidcProviderRequestBody(request);
  const provider: SsoOidcProviderResult = await createSsoOidcProvider(buildCreateSsoProviderInput(request, body));

  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildSsoOidcProviderAuditEventInput(provider, 'organization.sso_oidc_provider.created'),
    ),
  );
  return await reply.send(ssoOidcProviderResponseSchema.parse(buildSsoOidcProviderResponse(provider)));
}

async function handleSsoOidcProviderUpdate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: UpdateSsoOidcProviderRequest = readUpdateSsoOidcProviderRequestBody(request);
  const params: SsoOidcProviderRouteParams = readSsoOidcProviderRouteParams(request);
  const provider: SsoOidcProviderResult = await updateSsoOidcProvider(
    buildUpdateSsoProviderInput(request, params.providerId, body),
  );

  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildSsoOidcProviderAuditEventInput(provider, 'organization.sso_oidc_provider.updated'),
    ),
  );
  return await reply.send(ssoOidcProviderResponseSchema.parse(buildSsoOidcProviderResponse(provider)));
}

async function handleSsoOidcProviderDelete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: SsoOidcProviderRouteParams = readSsoOidcProviderRouteParams(request);
  const provider: SsoOidcProviderResult = await deleteSsoOidcProvider({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
    providerId: params.providerId,
  });

  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildSsoOidcProviderAuditEventInput(provider, 'organization.sso_oidc_provider.deleted'),
    ),
  );
  return await reply.send(buildDeleteSsoOidcProviderResponse());
}

function readCreateSsoOidcProviderRequestBody(request: FastifyRequest): ConfigureSsoOidcProviderRequest {
  return parseRequestValue(configureSsoOidcProviderRequestSchema, request.body, 'invalid_sso_provider_config');
}

function readUpdateSsoOidcProviderRequestBody(request: FastifyRequest): UpdateSsoOidcProviderRequest {
  return parseRequestValue(updateSsoOidcProviderRequestSchema, request.body, 'invalid_sso_provider_config');
}

function readSsoOidcProviderRouteParams(request: FastifyRequest): SsoOidcProviderRouteParams {
  return parseRequestValue(ssoOidcProviderRouteParamsSchema, request.params, 'invalid_sso_provider_params');
}

function buildCreateSsoProviderInput(
  request: FastifyRequest,
  body: ConfigureSsoOidcProviderRequest,
): CreateSsoOidcProviderInput {
  return {
    ...buildSsoProviderMutationInputBase(request, body),
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    key: body.key,
    preset: body.preset,
  };
}

function buildUpdateSsoProviderInput(
  request: FastifyRequest,
  providerId: string,
  body: UpdateSsoOidcProviderRequest,
): UpdateSsoOidcProviderInput {
  return {
    ...buildSsoProviderMutationInputBase(request, body),
    providerId,
  };
}

function buildSsoProviderMutationInputBase(
  request: FastifyRequest,
  body: UpdateSsoOidcProviderRequest,
): Omit<UpdateSsoOidcProviderInput, 'providerId'> {
  return {
    actorPrincipalId: request.actor.principalId,
    buttonText: body.buttonText,
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    displayName: body.displayName,
    identityVerification: body.identityVerification,
    issuerUrl: body.issuerUrl,
    key: body.key,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
    preset: body.preset,
    provisioning: body.provisioning,
    scope: body.scope,
  };
}

function buildDeleteSsoOidcProviderResponse(): DeleteSsoOidcProviderResponse {
  return deleteSsoOidcProviderResponseSchema.parse({ success: true });
}

function buildSsoOidcProviderAuditEventInput(
  provider: SsoOidcProviderResult,
  eventType: SsoOidcProviderAuditEventType,
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildSsoOidcProviderAuditMetadata({
      key: provider.key,
      preset: provider.preset,
    }),
    target: {
      displayName: provider.displayName,
      id: provider.id,
      type: 'sso_oidc_provider',
    },
  };
}
