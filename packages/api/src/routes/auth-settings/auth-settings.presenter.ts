import type { OrganizationAuthSettingsResponse } from '@compartment/contracts';
import type { OrganizationAuthSettingsResult } from '../../services/organization-auth-settings.service.types';

export function buildOrganizationAuthSettingsResponse(
  settings: OrganizationAuthSettingsResult,
): OrganizationAuthSettingsResponse {
  return {
    settings: {
      localPasswordEnabled: settings.localPasswordEnabled,
    },
  };
}
