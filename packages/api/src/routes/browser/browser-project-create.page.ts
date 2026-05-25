import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserProjectCreatePage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Create project',
  });
}
