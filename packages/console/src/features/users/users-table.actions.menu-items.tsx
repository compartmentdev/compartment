import { type JSX } from 'react';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import type { BrowserUsersAccessState, BrowserUsersUser } from '../../services/browser-users.service.types';
import type { UserActionHandler } from './user-actions';
import {
  type UserAccessMutation,
  type UserRemoveMutation,
  useUserAccessMutation,
  useUserRemoveMutation,
} from './users-table.mutations';

interface UserActionMenuItemProps {
  onUserAction: UserActionHandler;
  organizationSlug: string;
  setErrorMessage: (value: string | undefined) => void;
  user: BrowserUsersUser;
}

interface UserAccessMenuItemProps extends UserActionMenuItemProps {
  canBlockUser: boolean;
}

interface UserRemoveMenuItemProps extends UserActionMenuItemProps {
  canRemoveUser: boolean;
}

export function UserAccessMenuItem(props: Readonly<UserAccessMenuItemProps>): JSX.Element | null {
  const mutation: UserAccessMutation = useUserAccessMutation(
    props.onUserAction,
    props.organizationSlug,
    props.setErrorMessage,
    props.user,
  );

  if (!props.canBlockUser) {
    return null;
  }

  const label: string = props.user.access === 'blocked' ? 'Unblock' : 'Block';

  return (
    <DropdownMenuItem
      className={readUserAccessMenuItemClassName(props.user.access)}
      disabled={mutation.isPending}
      onSelect={(): void => {
        if (!mutation.isPending) {
          mutation.mutate();
        }
      }}
    >
      {mutation.isPending ? `${label}ing...` : label}
    </DropdownMenuItem>
  );
}

function readUserAccessMenuItemClassName(access: BrowserUsersAccessState): string | undefined {
  return access === 'blocked'
    ? undefined
    : 'text-destructive focus:text-destructive data-[highlighted]:text-destructive';
}

export function UserRemoveMenuItem({
  canRemoveUser,
  onUserAction,
  organizationSlug,
  setErrorMessage,
  user,
}: Readonly<UserRemoveMenuItemProps>): JSX.Element | null {
  const mutation: UserRemoveMutation = useUserRemoveMutation(onUserAction, organizationSlug, setErrorMessage, user);

  if (!canRemoveUser) {
    return null;
  }

  return (
    <DropdownMenuItem
      className="text-destructive focus:text-destructive data-[highlighted]:text-destructive"
      disabled={mutation.isPending}
      onSelect={(): void => {
        if (!mutation.isPending && window.prompt(`Type ${user.email} to remove this user.`) === user.email) {
          mutation.mutate();
        }
      }}
    >
      {mutation.isPending ? 'Removing...' : 'Remove'}
    </DropdownMenuItem>
  );
}
