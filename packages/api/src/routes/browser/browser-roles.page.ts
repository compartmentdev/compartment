import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserRolesPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Roles',
  });
}
