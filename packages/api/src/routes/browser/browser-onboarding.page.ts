import { renderBrowserAppShellPage } from './browser-app-shell.page';

export function renderBrowserOnboardingPage(): string {
  return renderBrowserAppShellPage({
    bundle: 'browser',
    title: 'Onboarding',
  });
}
