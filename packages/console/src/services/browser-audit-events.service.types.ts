import type { AuditEventSummary, AuditEventType, PermissionKey } from '@compartment/contracts/browser';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize, BrowserTableSortDirection } from './browser-table.service.types';

export type BrowserAuditEventsPageSize = BrowserTablePageSize;
export type BrowserAuditEventTypeFilter = AuditEventType | '';
export type BrowserAuditEventsSortBy = 'eventType' | 'occurredAt' | 'status';
export type BrowserAuditEventsSortDirection = BrowserTableSortDirection;

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
  sortBy: BrowserAuditEventsSortBy;
  sortDirection: BrowserAuditEventsSortDirection;
  totalEvents: number;
  totalPages: number;
}
