import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { Button } from '../../components/ui/button';
import { SquarePen } from '../../components/ui/icons';
import { buildRolesHref } from './roles-page.query';

interface ManageRolesButtonProps {
  onNavigate: BrowserSoftNavigateHandler;
  organizationSlug: string | null;
}

export function ManageRolesButton({ onNavigate, organizationSlug }: Readonly<ManageRolesButtonProps>): JSX.Element {
  return (
    <Button
      className={readManageRolesButtonClassName()}
      onClick={(): void => {
        onNavigate(readManageRolesHref(organizationSlug));
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      <SquarePen className="size-3.5" />
      Manage roles
    </Button>
  );
}

function readManageRolesHref(organizationSlug: string | null): string {
  return buildRolesHref({
    backHref: readCurrentRelativeHref(),
    organizationSlug,
  });
}

function readManageRolesButtonClassName(): string {
  return 'h-[22px] shrink-0 gap-1.5 rounded-md border-[#cfe0ff] bg-[#f5f9ff] px-2 text-[12px] font-medium leading-none text-[#2b6fe8] hover:bg-[#edf4ff]';
}

function readCurrentRelativeHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}
