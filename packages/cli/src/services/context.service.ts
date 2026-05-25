import { findOrganizationBySlug, type OrganizationSummary } from '@compartment/contracts';
import {
  createCompartmentBinaryRequester,
  createCompartmentRequester,
  type CompartmentBinaryRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { CliOrganizationConfig } from '../store/config.types';
import type { AuthenticatedContext, CreateAuthenticatedClientOptions } from './context.types';

const cliRequestTimeoutMs: number = 30_000;

export function createApiRequester(
  apiUrl: string,
  requestTimeoutMs: number = cliRequestTimeoutMs,
): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl,
    requestTimeoutMs,
  });
}

export function createAuthenticatedRequester(
  context: AuthenticatedContext,
  { includeCurrentOrganization, requestTimeoutMs = cliRequestTimeoutMs }: CreateAuthenticatedClientOptions,
): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl: context.apiUrl,
    ...(includeCurrentOrganization && context.currentOrganization !== undefined
      ? {
          currentOrganization: context.currentOrganization.slug,
        }
      : {}),
    requestTimeoutMs,
    sessionToken: context.sessionToken,
  });
}

export function createAuthenticatedBinaryRequester(
  context: AuthenticatedContext,
  { includeCurrentOrganization, requestTimeoutMs = cliRequestTimeoutMs }: CreateAuthenticatedClientOptions,
): CompartmentBinaryRequester {
  return createCompartmentBinaryRequester({
    apiUrl: context.apiUrl,
    ...(includeCurrentOrganization && context.currentOrganization !== undefined
      ? {
          currentOrganization: context.currentOrganization.slug,
        }
      : {}),
    requestTimeoutMs,
    sessionToken: context.sessionToken,
  });
}

export function requireOrganizationContext(context: AuthenticatedContext): AuthenticatedContext {
  if (context.currentOrganization === undefined) {
    throw new Error('No current organization is selected. Run `compartment org use <slug>` first.');
  }

  return context;
}

export function selectLoginOrganization(
  organizations: OrganizationSummary[],
  configuredOrganization?: CliOrganizationConfig,
): CliOrganizationConfig | undefined {
  const onlyOrganization: OrganizationSummary | null = selectOnlyOrganization(organizations);
  if (onlyOrganization !== null) {
    return toStoredOrganization(onlyOrganization);
  }
  if (configuredOrganization === undefined) {
    return undefined;
  }
  return selectConfiguredOrganizationBySlug(organizations, configuredOrganization);
}

export function resolveOrganizationBySlug(
  organizations: OrganizationSummary[],
  organizationSlug: string,
): CliOrganizationConfig {
  const organization: OrganizationSummary | null = findOrganizationBySlug(organizations, organizationSlug);
  if (organization === null) {
    throw new Error(`Organization slug "${organizationSlug}" was not found.`);
  }
  return toStoredOrganization(organization);
}

function selectOnlyOrganization(organizations: OrganizationSummary[]): OrganizationSummary | null {
  if (organizations.length !== 1) {
    return null;
  }

  return organizations[0] ?? null;
}

function selectConfiguredOrganizationBySlug(
  organizations: OrganizationSummary[],
  configuredOrganization: CliOrganizationConfig,
): CliOrganizationConfig | undefined {
  const matchingOrganization: OrganizationSummary | null = findOrganizationBySlug(
    organizations,
    configuredOrganization.slug,
  );
  return matchingOrganization !== null ? toStoredOrganization(matchingOrganization) : undefined;
}

function toStoredOrganization(organization: OrganizationSummary): CliOrganizationConfig {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  };
}
