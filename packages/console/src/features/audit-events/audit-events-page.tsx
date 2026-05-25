import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserAuditEventsPageResult } from '../../services/browser-audit-events.service.types';
import { useBrowserPageData, useBrowserSoftNavigateHandler } from '../console/console-page';
import { loadAuditEventsPageData } from './audit-events-loader';
import { AuditEventsView } from './audit-events-view';

export async function loadAuditEventsPage(args: LoaderFunctionArgs): Promise<BrowserAuditEventsPageResult> {
  return await loadAuditEventsPageData(args);
}

export function AuditEventsPage(): JSX.Element {
  const loaderData: BrowserAuditEventsPageResult = useLoaderData();
  const [data] = useBrowserPageData(loaderData);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();

  return <AuditEventsView data={data} onNavigate={onNavigate} />;
}
