import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserProjectsPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Projects',
  });
}
