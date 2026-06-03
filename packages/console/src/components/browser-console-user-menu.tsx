import type { JSX } from 'react';
import { browserLoginPathname } from '../browser-public-paths';
import { logoutBrowserSession } from '../lib/browser-logout';
import type { BrowserConsoleErrorHandler } from './browser-console.types';
import { ChevronsUpDown } from './ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { MinidenticonAvatar } from './ui/minidenticon-avatar';

interface BrowserConsoleUserBlockProps {
  onError: BrowserConsoleErrorHandler;
  principalEmail: string;
}

interface BrowserConsoleUserMetaProps {
  principalEmail: string;
  principalLabel: string;
}

interface BrowserConsoleUserMenuContentProps {
  onError: BrowserConsoleErrorHandler;
}

interface BrowserConsoleUserAvatarProps {
  principalEmail: string;
}

export function BrowserConsoleUserBlock({
  onError,
  principalEmail,
}: Readonly<BrowserConsoleUserBlockProps>): JSX.Element {
  const [principalLabel = principalEmail] = principalEmail.split('@');

  return (
    <div className="flex w-full items-center gap-2 rounded-control p-2">
      <BrowserConsoleUserAvatar principalEmail={principalEmail} />
      <BrowserConsoleUserMeta principalEmail={principalEmail} principalLabel={principalLabel} />
      <DropdownMenu>
        <BrowserConsoleUserMenuTrigger />
        <BrowserConsoleUserMenuContent onError={onError} />
      </DropdownMenu>
    </div>
  );
}

function BrowserConsoleUserAvatar({ principalEmail }: Readonly<BrowserConsoleUserAvatarProps>): JSX.Element {
  return <MinidenticonAvatar className="bg-background" seed={principalEmail} />;
}

function BrowserConsoleUserMeta({
  principalEmail,
  principalLabel,
}: Readonly<BrowserConsoleUserMetaProps>): JSX.Element {
  return (
    <div className="min-w-0 flex-1 text-sidebar-foreground">
      <p className="truncate text-[14px] font-medium leading-5">{principalLabel}</p>
      <p className="truncate text-[12px] font-normal leading-4">{principalEmail}</p>
    </div>
  );
}

function BrowserConsoleUserMenuTrigger(): JSX.Element {
  return (
    <DropdownMenuTrigger asChild>
      <button
        aria-label="Open user menu"
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-micro text-sidebar-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        type="button"
      >
        <ChevronsUpDown aria-hidden="true" className="size-4" />
      </button>
    </DropdownMenuTrigger>
  );
}

function BrowserConsoleUserMenuContent({ onError }: Readonly<BrowserConsoleUserMenuContentProps>): JSX.Element {
  return (
    <DropdownMenuContent align="end" side="top">
      <DropdownMenuItem
        onSelect={(): void => {
          void signOutFromBrowserConsole(onError);
        }}
      >
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

async function signOutFromBrowserConsole(onError: BrowserConsoleErrorHandler): Promise<void> {
  onError(undefined);
  try {
    await logoutBrowserSession();
    window.location.assign(browserLoginPathname);
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not sign out.');
  }
}
