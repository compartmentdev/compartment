import { browserLoginPathname } from '../browser-public-paths';
import { BrowserApiError } from './browser-api';

export class BrowserRedirect extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`Redirect to ${to}.`);
    this.name = 'BrowserRedirect';
    this.to = to;
  }
}

export function redirectBrowserWindow(error: Error): boolean {
  if (!(error instanceof BrowserRedirect)) {
    return false;
  }

  window.location.assign(error.to);
  return true;
}

export function readBrowserApiRedirect(error: Error, forbiddenTo?: string): BrowserRedirect | null {
  if (!(error instanceof BrowserApiError)) {
    return null;
  }
  if (error.status === 401) {
    return new BrowserRedirect(browserLoginPathname);
  }
  if (error.status === 403 && forbiddenTo !== undefined) {
    return new BrowserRedirect(forbiddenTo);
  }

  return null;
}
