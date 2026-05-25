import {
  compartmentCustomDomainsPathname,
  type CreateCustomDomainRequest,
  type CreateCustomDomainResponse,
  type CustomDomainResponse,
  type ListCustomDomainsQuery,
  type ListCustomDomainsResponse,
  type RemoveCustomDomainResponse,
  type VerifyCustomDomainResponse,
  createCustomDomainRequestSchema,
  createCustomDomainResponseSchema,
  customDomainResponseSchema,
  listCustomDomainsQuerySchema,
  listCustomDomainsResponseSchema,
  removeCustomDomainResponseSchema,
  verifyCustomDomainResponseSchema,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import {
  addCustomDomain,
  getCustomDomain,
  listCustomDomains,
  removeCustomDomain,
  verifyCustomDomain,
} from '../../services/custom-domain.service';
import type {
  CustomDomainListResult,
  CustomDomainServiceResult,
  RemovedCustomDomainResult,
} from '../../services/custom-domain.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import {
  presentCreateCustomDomainResponse,
  presentCustomDomainResponse,
  presentListCustomDomainsResponse,
  presentRemoveCustomDomainResponse,
  presentVerifyCustomDomainResponse,
} from './custom-domain.presenter';
import { customDomainRouteParamsSchema, type CustomDomainRouteParams } from './custom-domain.route.types';

export function registerCustomDomainRoutes(app: ApiApp): void {
  registerCustomDomainCollectionRoutes(app);
  registerCustomDomainItemRoutes(app);
}

function registerCustomDomainCollectionRoutes(app: ApiApp): void {
  app.get(
    compartmentCustomDomainsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: listCustomDomainsResponseSchema }),
    handleListCustomDomains,
  );
  app.post(
    compartmentCustomDomainsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 201: createCustomDomainResponseSchema }),
    handleCreateCustomDomain,
  );
}

function registerCustomDomainItemRoutes(app: ApiApp): void {
  const customDomainRoutePathname: string = `${compartmentCustomDomainsPathname}/:host`;

  app.get(
    customDomainRoutePathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: customDomainResponseSchema }),
    handleGetCustomDomain,
  );
  app.post(
    `${customDomainRoutePathname}/verify`,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: verifyCustomDomainResponseSchema }),
    handleVerifyCustomDomain,
  );
  app.delete(
    customDomainRoutePathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: removeCustomDomainResponseSchema }),
    handleRemoveCustomDomain,
  );
}

async function handleListCustomDomains(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: ListCustomDomainsQuery = parseRequestValue(
    listCustomDomainsQuerySchema,
    request.query,
    'invalid_custom_domain_query',
  );
  const result: CustomDomainListResult = await listCustomDomains({
    environmentName: query.environmentName,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
    projectName: query.projectName,
    serviceName: query.serviceName,
  });
  const response: ListCustomDomainsResponse = listCustomDomainsResponseSchema.parse(
    presentListCustomDomainsResponse(result),
  );

  return await reply.send(response);
}

async function handleCreateCustomDomain(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateCustomDomainRequest = parseRequestValue(
    createCustomDomainRequestSchema,
    request.body,
    'invalid_custom_domain_body',
  );
  const result: CustomDomainServiceResult = await addCustomDomain({
    environmentName: body.environmentName,
    host: body.host,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
    projectName: body.projectName,
    serviceName: body.serviceName,
  });
  const response: CreateCustomDomainResponse = createCustomDomainResponseSchema.parse(
    presentCreateCustomDomainResponse(result),
  );

  return await reply.code(201).send(response);
}

async function handleGetCustomDomain(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: CustomDomainRouteParams = parseCustomDomainParams(request);
  const result: CustomDomainServiceResult = await getCustomDomain({
    host: params.host,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
  });
  const response: CustomDomainResponse = customDomainResponseSchema.parse(presentCustomDomainResponse(result));

  return await reply.send(response);
}

async function handleVerifyCustomDomain(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: CustomDomainRouteParams = parseCustomDomainParams(request);
  const result: CustomDomainServiceResult = await verifyCustomDomain({
    host: params.host,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
  });
  const response: VerifyCustomDomainResponse = verifyCustomDomainResponseSchema.parse(
    presentVerifyCustomDomainResponse(result),
  );

  return await reply.send(response);
}

async function handleRemoveCustomDomain(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: CustomDomainRouteParams = parseCustomDomainParams(request);
  const result: RemovedCustomDomainResult = await removeCustomDomain({
    host: params.host,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
  });
  const response: RemoveCustomDomainResponse = removeCustomDomainResponseSchema.parse(
    presentRemoveCustomDomainResponse(result),
  );

  return await reply.send(response);
}

function parseCustomDomainParams(request: FastifyRequest): CustomDomainRouteParams {
  return parseRequestValue(customDomainRouteParamsSchema, request.params, 'invalid_custom_domain_params');
}
