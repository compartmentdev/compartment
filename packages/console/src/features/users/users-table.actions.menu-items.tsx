import { type JSX } from 'react';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import type { BrowserUsersUser } from '../../services/browser-users.service.types';
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
      className={props.user.access === 'blocked' ? undefined : 'text-red-700 data-[highlighted]:text-red-800'}
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
      className="text-red-700 data-[highlighted]:text-red-800"
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
