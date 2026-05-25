import type { AuditEventSummary, AuditEventType, PermissionKey } from '@compartment/contracts/browser';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize } from './browser-table.service.types';

export type BrowserAuditEventsPageSize = BrowserTablePageSize;
export type BrowserAuditEventTypeFilter = AuditEventType | '';

export interface BrowserAuditEventFilters {
  actor: string;
  eventType: BrowserAuditEventTypeFilter;
  from: string;
  project: string;
  targetType: string;
  to: string;
}

export interface BrowserAuditEventsPageResult {
  currentOrganizationPermissions: PermissionKey[];
  events: AuditEventSummary[];
  filters: BrowserAuditEventFilters;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  page: number;
  pageSize: BrowserAuditEventsPageSize;
  pageSizeOptions: BrowserAuditEventsPageSize[];
  principalEmail: string;
  projectCount?: number | undefined;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  totalEvents: number;
  totalPages: number;
}
