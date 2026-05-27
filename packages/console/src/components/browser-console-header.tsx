import type { PermissionKey } from '@compartment/contracts/browser';
import { useState, type JSX, type ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { type BrowserConsoleShellData, useBrowserConsoleShellRouteData } from '../features/console/console-shell-route';
import { BrowserConsoleSidebar } from './browser-console-sidebar';

export type BrowserConsolePage = 'audit' | 'groups' | 'projects' | 'roles' | 'users';
const browserConsolePageFrameClassName: string = 'mx-auto min-h-screen w-full max-w-[1500px]';
export const browserConsolePageClassName: string = 'flex min-h-screen w-full flex-col';
export const browserConsolePageGutterClassName: string = 'px-4 sm:px-6 lg:px-8';
export const browserConsolePageHeaderClassName: string = 'px-4 pt-8 sm:px-6 lg:px-8';
export const browserConsoleDetailPageHeaderClassName: string = 'border-b border-border px-4 pt-5 sm:px-6 lg:px-8';
export const browserConsolePageBodyClassName: string = 'flex w-full flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8';

interface BrowserConsoleShellProps {
  children: ReactNode;
  currentOrganizationPermissions?: PermissionKey[] | undefined;
  organizationControl?: JSX.Element | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  page: BrowserConsolePage;
  principalEmail?: string | undefined;
  projectCount?: number | undefined;
  selectedOrganizationSlug?: string | null | undefined;
}

interface ResolvedBrowserConsoleShellProps extends BrowserConsoleShellProps {
  currentOrganizationPermissions: PermissionKey[];
  principalEmail: string;
  selectedOrganizationSlug: string | null;
}

interface BrowserConsoleShellBodyProps extends ResolvedBrowserConsoleShellProps {
  errorMessage: string | undefined;
  onError: (message: string | undefined) => void;
}

export function BrowserConsoleShell(props: Readonly<BrowserConsoleShellProps>): JSX.Element {
  const shellData: BrowserConsoleShellData | null = useBrowserConsoleShellRouteData();
  const resolvedProps: ResolvedBrowserConsoleShellProps = readResolvedBrowserConsoleShellProps(props, shellData);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  return <BrowserConsoleShellBody {...resolvedProps} errorMessage={errorMessage} onError={setErrorMessage} />;
}

function BrowserConsoleShellBody(props: Readonly<BrowserConsoleShellBodyProps>): JSX.Element {
  return (
    <div className="min-h-screen bg-[linear-gradient(164deg,var(--background)_1.33%,var(--muted)_100%)] text-foreground lg:flex">
      <BrowserConsoleSidebar
        currentOrganizationPermissions={props.currentOrganizationPermissions}
        errorMessage={props.errorMessage}
        onError={props.onError}
        onNavigate={props.onNavigate}
        organizationControl={props.organizationControl ?? null}
        page={props.page}
        principalEmail={props.principalEmail}
        projectCount={props.projectCount}
        selectedOrganizationSlug={props.selectedOrganizationSlug}
      />
      <main className="min-w-0 flex-1">
        <div className={browserConsolePageFrameClassName}>{props.children}</div>
      </main>
    </div>
  );
}

function readResolvedBrowserConsoleShellProps(
  props: Readonly<BrowserConsoleShellProps>,
  shellData: BrowserConsoleShellData | null,
): ResolvedBrowserConsoleShellProps {
  const currentOrganizationPermissions: PermissionKey[] | undefined =
    shellData?.currentOrganizationPermissions ?? props.currentOrganizationPermissions;
  const principalEmail: string | undefined = shellData?.principalEmail ?? props.principalEmail;
  const selectedOrganizationSlug: string | null | undefined =
    shellData?.selectedOrganizationSlug ?? props.selectedOrganizationSlug;
  if (
    currentOrganizationPermissions === undefined ||
    principalEmail === undefined ||
    selectedOrganizationSlug === undefined
  ) {
    throw new Error('Expected console shell route data or explicit shell props.');
  }

  return {
    ...props,
    currentOrganizationPermissions,
    principalEmail,
    projectCount: shellData?.projectCount ?? props.projectCount,
    selectedOrganizationSlug,
  };
}
