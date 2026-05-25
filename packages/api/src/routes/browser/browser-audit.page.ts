import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserAuditPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Audit logs',
  });
}
