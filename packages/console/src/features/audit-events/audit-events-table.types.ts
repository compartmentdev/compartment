import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type {
  BrowserAuditEventsPageResult,
  BrowserAuditEventsSortBy,
} from '../../services/browser-audit-events.service.types';

export interface AuditEventsSortableHeadingProps {
  data: BrowserAuditEventsPageResult;
  label: string;
  onNavigate: BrowserSoftNavigateHandler;
  sortBy: BrowserAuditEventsSortBy;
}
