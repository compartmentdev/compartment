import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserGroupsPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Groups',
  });
}
