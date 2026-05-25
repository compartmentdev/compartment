import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserProjectDeploymentsPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Deployments',
  });
}
