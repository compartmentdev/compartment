import { z } from 'zod';
import { operationSummarySchema, type OperationSummary } from './operations.contract';
import type { ContractSchema } from './schema.types';

type CompartmentCurrentOrganizationHeaderName = 'x-compartment-organization';
const organizationSlugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const compartmentCurrentOrganizationHeaderName: CompartmentCurrentOrganizationHeaderName =
  'x-compartment-organization';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface OrganizationListResponse {
  organizations: OrganizationSummary[];
}

export interface CreateOrganizationRequest {
  name: string;
  slug?: string | undefined;
}

export interface CreateOrganizationResponse {
  operation: OperationSummary;
  organization: OrganizationSummary;
}

export function isOrganizationSlug(value: string): boolean {
  return organizationSlugPattern.test(value);
}

export const organizationSlugSchema: ContractSchema<string> = z
  .string()
  .regex(organizationSlugPattern, 'Organization slug must use lowercase letters, digits, and single hyphens.');

export const organizationSummarySchema: ContractSchema<OrganizationSummary> = z
  .object({
    id: z.string().min(1),
    slug: organizationSlugSchema,
    name: z.string().min(1),
  })
  .strict();

export const organizationListResponseSchema: ContractSchema<OrganizationListResponse> = z
  .object({
    organizations: z.array(organizationSummarySchema),
  })
  .strict();

export const createOrganizationRequestSchema: ContractSchema<CreateOrganizationRequest> = z
  .object({
    name: z.string().min(1),
    slug: organizationSlugSchema.optional(),
  })
  .strict();

export const createOrganizationResponseSchema: ContractSchema<CreateOrganizationResponse> = z
  .object({
    operation: operationSummarySchema,
    organization: organizationSummarySchema,
  })
  .strict();
