import type {
  CreateCustomDomainResponse,
  CustomDomainResponse,
  ListCustomDomainsResponse,
  RemoveCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@compartment/contracts';
import {
  createCustomDomain as createCustomDomainApi,
  getCustomDomain as getCustomDomainApi,
  listCustomDomains as listCustomDomainsApi,
  removeCustomDomain as removeCustomDomainApi,
  verifyCustomDomain as verifyCustomDomainApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import { hasText } from '@compartment/utils';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { resolveProjectTarget } from './project-target.service';
import type { ResolvedProjectTarget } from './projects.service.types';
import type {
  AddCustomDomainCommandInput,
  CustomDomainHostCommandInput,
  ListCustomDomainsCommandInput,
} from './custom-domains.service.types';

export async function addCustomDomain(
  context: AuthenticatedContext,
  input: AddCustomDomainCommandInput,
): Promise<CreateCustomDomainResponse> {
  const request: CompartmentRequester = createCustomDomainRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await createCustomDomainApi(request, {
    environmentName: input.environmentName,
    host: input.host,
    projectName: target.projectName,
    serviceName: readCustomDomainServiceName(target, input.serviceName),
  });
}

export async function listCustomDomains(
  context: AuthenticatedContext,
  input: ListCustomDomainsCommandInput,
): Promise<ListCustomDomainsResponse> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await listCustomDomainsApi(createCustomDomainRequester(context), {
    environmentName: input.environmentName,
    projectName: target.projectName,
    serviceName: input.serviceName,
  });
}

export async function showCustomDomain(
  context: AuthenticatedContext,
  input: CustomDomainHostCommandInput,
): Promise<CustomDomainResponse> {
  return await getCustomDomainApi(createCustomDomainRequester(context), input.host);
}

export async function verifyCustomDomain(
  context: AuthenticatedContext,
  input: CustomDomainHostCommandInput,
): Promise<VerifyCustomDomainResponse> {
  return await verifyCustomDomainApi(createCustomDomainRequester(context), input.host);
}

export async function removeCustomDomain(
  context: AuthenticatedContext,
  input: CustomDomainHostCommandInput,
): Promise<RemoveCustomDomainResponse> {
  return await removeCustomDomainApi(createCustomDomainRequester(context), input.host);
}

function createCustomDomainRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

function readCustomDomainServiceName(target: ResolvedProjectTarget, serviceName: string | undefined): string {
  if (hasText(serviceName)) {
    return serviceName;
  }
  if (!target.updatesLocalDescriptor) {
    throw new Error('Service is required for custom domains. Pass --service <name>.');
  }

  const serviceNames: string[] = Object.keys(target.descriptor?.descriptor.services ?? {});
  if (serviceNames.length === 1) {
    return serviceNames[0]!;
  }

  throw new Error('Service is required for custom domains. Pass --service <name>.');
}
