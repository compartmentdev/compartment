import {
  compartmentResourcePathnameTemplate,
  resourceResponseSchema,
  type ResourceResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { getResourceForPrincipal } from '../../services/resources.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { requireAnyResourceAccess } from './resource-authorization';
import { buildResourceResponse } from './resource.presenter';
import {
  resourceListRouteQuerySchema,
  resourceRouteParamsSchema,
  resourceTargetRouteQuerySchema,
  type ResourceListQuery,
  type ResourceRouteParams,
  type ResourceTargetQuery,
} from './resource.route.types';

interface ResourceTargetQueryParseOptions {
  ignoredParamKeys?: readonly string[] | undefined;
  ignoredQueryKeys?: readonly string[] | undefined;
}

interface ResourceTargetRawParams {
  [key: string]: boolean | string | undefined;
  outputName?: string | undefined;
  resourceName?: string | undefined;
}

interface ResourceTargetRawQuery {
  [key: string]: boolean | string | undefined;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  reveal?: boolean | string | undefined;
}

type ResourceTargetRawValue = ResourceTargetRawParams | ResourceTargetRawQuery;

export function registerGetResourceRoute(app: ApiApp): void {
  app.get(compartmentResourcePathnameTemplate, createCurrentOrganizationRouteOptions(), handleGetResourceRequest);
}

async function handleGetResourceRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnyResourceAccess(request);
  const query: ResourceTargetQuery = parseResourceTargetQuery(request);
  const response: ResourceResponse = resourceResponseSchema.parse(
    buildResourceResponse(
      await getResourceForPrincipal({
        actorPrincipalId: request.actor.principalId,
        organizationSlug: request.currentOrganization.slug,
        query,
      }),
    ),
  );

  return await reply.send(response);
}

export function parseResourceTargetQuery(
  request: FastifyRequest,
  options: ResourceTargetQueryParseOptions = {},
): ResourceTargetQuery {
  const params: ResourceRouteParams = parseRequestValue(
    resourceRouteParamsSchema,
    stripIgnoredResourceTargetKeys(
      request.params as ResourceTargetRawParams,
      options.ignoredParamKeys,
    ) as ResourceRouteParams,
    'invalid_resource_params',
  );
  const query: ResourceListQuery = parseRequestValue(
    resourceListRouteQuerySchema,
    stripIgnoredResourceTargetKeys(
      request.query as ResourceTargetRawQuery,
      options.ignoredQueryKeys,
    ) as ResourceListQuery,
    'invalid_resource_query',
  );

  return resourceTargetRouteQuerySchema.parse({
    ...query,
    resourceName: params.resourceName,
  });
}

function stripIgnoredResourceTargetKeys(
  value: ResourceTargetRawValue,
  ignoredKeys: readonly string[] | undefined,
): ResourceTargetRawValue {
  if (ignoredKeys === undefined || ignoredKeys.length === 0) {
    return value;
  }

  const targetValue: ResourceTargetRawValue = { ...value };
  for (const ignoredKey of ignoredKeys) {
    delete targetValue[ignoredKey];
  }

  return targetValue;
}
