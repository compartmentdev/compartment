import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserLoginPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'auth',
    title: 'Log in',
  });
}
