import type { AccessGroupListRow } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { MoreHorizontal } from '../../components/ui/icons';

interface GroupActionsTriggerProps {
  group: AccessGroupListRow;
}

interface GroupRemoveMenuItemProps {
  isPending: boolean;
  onSelect: () => void;
}

export function GroupActionsTrigger({ group }: Readonly<GroupActionsTriggerProps>): JSX.Element {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        aria-label={`Open actions for ${group.name}`}
        className="size-7 px-0 text-muted-foreground"
        size="sm"
        type="button"
        variant="secondary"
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
  );
}

export function GroupRemoveMenuItem({ isPending, onSelect }: Readonly<GroupRemoveMenuItemProps>): JSX.Element {
  return (
    <DropdownMenuItem
      className="text-red-700 focus:text-red-800"
      disabled={isPending}
      onSelect={(): void => {
        if (!isPending) {
          onSelect();
        }
      }}
    >
      {isPending ? 'Removing...' : 'Remove'}
    </DropdownMenuItem>
  );
}

export function readGroupDescription(group: Readonly<AccessGroupListRow>): string {
  return group.description === null || group.description === '' ? 'No description' : group.description;
}
