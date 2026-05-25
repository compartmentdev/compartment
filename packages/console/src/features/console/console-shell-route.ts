import { createContext, createElement, useContext, type Context, type JSX } from 'react';
import { Outlet, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { loadBrowserConsoleContext, loadSidebarProjectCount, type BrowserConsoleContext } from './console-data';

export interface BrowserConsoleShellData extends BrowserConsoleContext {
  projectCount?: number | undefined;
}

export const browserConsoleShellRouteId: string = 'browser-console-shell';

const browserConsoleShellRouteDataContext: Context<BrowserConsoleShellData | null> =
  createContext<BrowserConsoleShellData | null>(null);

export async function loadBrowserConsoleShellRouteData({
  request,
}: LoaderFunctionArgs): Promise<BrowserConsoleShellData> {
  const consoleContext: BrowserConsoleContext = await loadBrowserConsoleContext(
    new URL(request.url),
    { signal: request.signal },
    { allowLegacyOrganizationQuery: false },
  );

  return await buildBrowserConsoleShellData(consoleContext, request.signal);
}

export function BrowserConsoleShellRouteBoundary(): JSX.Element {
  const shellData: BrowserConsoleShellData = useLoaderData();

  return createElement(browserConsoleShellRouteDataContext.Provider, { value: shellData }, createElement(Outlet));
}

export function useBrowserConsoleShellRouteData(): BrowserConsoleShellData | null {
  return useContext(browserConsoleShellRouteDataContext);
}

async function buildBrowserConsoleShellData(
  consoleContext: BrowserConsoleContext,
  signal: AbortSignal,
): Promise<BrowserConsoleShellData> {
  if (consoleContext.selectedOrganizationSlug === null) {
    return consoleContext;
  }

  return {
    ...consoleContext,
    projectCount: await loadSidebarProjectCount(consoleContext.selectedOrganizationSlug, { signal }),
  };
}
