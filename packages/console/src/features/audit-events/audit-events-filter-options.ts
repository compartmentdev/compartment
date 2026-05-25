export interface AuditTargetTypeOption {
  label: string;
  value: string;
}

export const auditTargetTypeOptions: readonly AuditTargetTypeOption[] = [
  { label: 'Assignment', value: 'assignment' },
  { label: 'Audit export', value: 'audit_export' },
  { label: 'Deployment', value: 'deployment' },
  { label: 'Descriptor', value: 'descriptor' },
  { label: 'Group', value: 'group' },
  { label: 'Organization', value: 'organization' },
  { label: 'Role', value: 'role' },
  { label: 'Source', value: 'source' },
  { label: 'Source binding', value: 'source_binding' },
  { label: 'Source descriptor', value: 'source_descriptor' },
  { label: 'Source push', value: 'source_push' },
  { label: 'Source sync', value: 'source_sync' },
  { label: 'SSO/OIDC provider', value: 'sso_oidc_provider' },
  { label: 'User', value: 'user' },
];
