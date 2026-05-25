import {
  compartmentCustomDomainsPathname,
  createCustomDomainResponseSchema,
  customDomainResponseSchema,
  listCustomDomainsResponseSchema,
  removeCustomDomainResponseSchema,
  verifyCustomDomainResponseSchema,
  type CreateCustomDomainRequest,
  type CreateCustomDomainResponse,
  type CustomDomainResponse,
  type ListCustomDomainsQuery,
  type ListCustomDomainsResponse,
  type RemoveCustomDomainResponse,
  type VerifyCustomDomainResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function createCustomDomain(
  request: CompartmentRequester,
  body: CreateCustomDomainRequest,
): Promise<CreateCustomDomainResponse> {
  return await request<CreateCustomDomainResponse, CreateCustomDomainRequest>({
    body,
    method: 'POST',
    path: compartmentCustomDomainsPathname,
    schema: createCustomDomainResponseSchema,
  });
}

export async function listCustomDomains(
  request: CompartmentRequester,
  query: ListCustomDomainsQuery = {},
): Promise<ListCustomDomainsResponse> {
  return await request<ListCustomDomainsResponse, undefined>({
    method: 'GET',
    path: buildCustomDomainListPath(query),
    schema: listCustomDomainsResponseSchema,
  });
}

export async function getCustomDomain(request: CompartmentRequester, host: string): Promise<CustomDomainResponse> {
  return await request<CustomDomainResponse, undefined>({
    method: 'GET',
    path: buildCustomDomainPath(host),
    schema: customDomainResponseSchema,
  });
}

export async function verifyCustomDomain(
  request: CompartmentRequester,
  host: string,
): Promise<VerifyCustomDomainResponse> {
  return await request<VerifyCustomDomainResponse, undefined>({
    method: 'POST',
    path: `${buildCustomDomainPath(host)}/verify`,
    schema: verifyCustomDomainResponseSchema,
  });
}

export async function removeCustomDomain(
  request: CompartmentRequester,
  host: string,
): Promise<RemoveCustomDomainResponse> {
  return await request<RemoveCustomDomainResponse, undefined>({
    method: 'DELETE',
    path: buildCustomDomainPath(host),
    schema: removeCustomDomainResponseSchema,
  });
}

function buildCustomDomainListPath(query: ListCustomDomainsQuery): string {
  return buildListPath(compartmentCustomDomainsPathname, [
    { name: 'environmentName', value: query.environmentName },
    { name: 'projectName', value: query.projectName },
    { name: 'serviceName', value: query.serviceName },
  ]);
}

function buildCustomDomainPath(host: string): string {
  return `${compartmentCustomDomainsPathname}/${encodeURIComponent(host)}`;
}
