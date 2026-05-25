export interface OrganizationAuthSettingsRow {
  localPasswordEnabled: boolean;
  organizationId: string;
}

export interface UpdateOrganizationAuthSettingsInput {
  localPasswordEnabled: boolean;
  organizationId: string;
}
