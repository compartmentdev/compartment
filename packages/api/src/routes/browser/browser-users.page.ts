import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserUsersPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Users',
  });
}
