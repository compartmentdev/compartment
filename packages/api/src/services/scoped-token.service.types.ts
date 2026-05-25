export type ScopedTokenScope = OrganizationScopedTokenScope | SystemScopedTokenScope;

export interface OrganizationScopedTokenScope {
  kind: 'organization';
  organizationId: string;
}

export interface SystemScopedTokenScope {
  kind: 'system';
}
