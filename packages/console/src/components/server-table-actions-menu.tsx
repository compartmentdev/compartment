import type { JSX, ReactNode } from 'react';
import { readServerTableActionControlClassName } from './server-table';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';
import { MoreHorizontal } from './ui/icons';

interface ServerTableActionsMenuProps {
  ariaLabel: string;
  children: ReactNode;
}

export function ServerTableActionsMenu({ ariaLabel, children }: Readonly<ServerTableActionsMenuProps>): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={ariaLabel}
          className={`${readServerTableActionControlClassName()} w-7 px-0 text-muted-foreground`}
          size="sm"
          type="button"
          variant="secondary"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
