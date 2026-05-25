import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserAuditEventsPageResult } from '../../services/browser-audit-events.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { buildAuditEventsHref } from './audit-events-query';

interface AuditEventsOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  data: BrowserAuditEventsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function AuditEventsOrganizationContextPanel({
  context,
  data,
  onNavigate,
}: Readonly<AuditEventsOrganizationContextPanelProps>): JSX.Element {
  return (
    <BrowserConsoleOrganizationContextPanel
      context={context}
      onNavigate={onNavigate}
      organizations={data.organizations}
      readOrganizationHref={(organizationSlug: string): string =>
        buildAuditEventsHref(data, { page: 1, selectedOrganizationSlug: organizationSlug })
      }
    />
  );
}
