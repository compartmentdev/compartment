interface OrganizationLoginMethodState {
  localPasswordEnabled: boolean;
  oidcProviderCount: number;
}

export function hasEnabledLoginMethod(input: OrganizationLoginMethodState): boolean {
  return input.localPasswordEnabled || input.oidcProviderCount > 0;
}
