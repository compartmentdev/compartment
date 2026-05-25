import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserProjectOverviewPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Project Overview',
  });
}
