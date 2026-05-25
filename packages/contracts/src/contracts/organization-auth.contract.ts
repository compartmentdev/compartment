import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface OrganizationAuthSettingsSummary {
  localPasswordEnabled: boolean;
}

export interface OrganizationAuthSettingsResponse {
  settings: OrganizationAuthSettingsSummary;
}

export interface UpdateOrganizationAuthSettingsRequest {
  localPasswordEnabled: boolean;
}

const organizationAuthSettingsSummarySchema: ContractSchema<OrganizationAuthSettingsSummary> = z
  .object({
    localPasswordEnabled: z.boolean(),
  })
  .strict();

export const organizationAuthSettingsResponseSchema: ContractSchema<OrganizationAuthSettingsResponse> = z
  .object({
    settings: organizationAuthSettingsSummarySchema,
  })
  .strict();

export const updateOrganizationAuthSettingsRequestSchema: ContractSchema<UpdateOrganizationAuthSettingsRequest> = z
  .object({
    localPasswordEnabled: z.boolean(),
  })
  .strict();
