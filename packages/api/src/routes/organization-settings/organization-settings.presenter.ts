import type { OrganizationSettingsResponse } from '@compartment/contracts';
import type { OrganizationSettingsResult } from '../../services/organization-settings.service.types';

export function buildOrganizationSettingsResponse(settings: OrganizationSettingsResult): OrganizationSettingsResponse {
  return {
    settings: {
      auditRetention: settings.auditRetention,
      rollbackRetention: settings.rollbackRetention,
    },
  };
}
