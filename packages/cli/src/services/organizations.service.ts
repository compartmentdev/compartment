import type { OrganizationListResponse } from '@compartment/contracts';

import type { CliOrganizationConfig } from '../store/config.types';
import { createAuthenticatedRequester, resolveOrganizationBySlug } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { listOrganizations as listOrganizationsRequester } from '@compartment/sdk';

export async function listOrganizations(context: AuthenticatedContext): Promise<OrganizationListResponse> {
  return await listOrganizationsRequester(
    createAuthenticatedRequester(context, {
      includeCurrentOrganization: false,
    }),
  );
}

export async function useOrganization(
  context: AuthenticatedContext,
  organizationSlug: string,
): Promise<CliOrganizationConfig> {
  const response: OrganizationListResponse = await listOrganizationsRequester(
    createAuthenticatedRequester(context, {
      includeCurrentOrganization: false,
    }),
  );
  return resolveOrganizationBySlug(response.organizations, organizationSlug);
}
