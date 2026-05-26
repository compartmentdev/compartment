import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { Button } from '../../components/ui/button';
import { Drama } from '../../components/ui/icons';
import { accessDrawerHeaderActionButtonClassName } from '../access/access-ui';
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
      variant="soft"
    >
      <Drama className="size-4" />
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
  return accessDrawerHeaderActionButtonClassName;
}

function readCurrentRelativeHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}
