import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { shouldRevalidateRolesPage } from '../roles/roles-page.navigation';
import {
  readBrowserConsoleRequestedOrganizationSlug,
  readBrowserConsoleRouteInput,
} from './console-organization-route';

export function shouldRevalidateBrowserConsoleShellRoute(args: ShouldRevalidateFunctionArgs): boolean {
  if (hasRequestedOrganizationChange(args.currentUrl, args.nextUrl)) {
    return true;
  }

  return shouldRevalidateRolesPage(args);
}

function hasRequestedOrganizationChange(currentUrl: URL, nextUrl: URL): boolean {
  return (
    readBrowserConsoleRequestedOrganizationSlug(readBrowserConsoleRouteInput(currentUrl)) !==
    readBrowserConsoleRequestedOrganizationSlug(readBrowserConsoleRouteInput(nextUrl))
  );
}
