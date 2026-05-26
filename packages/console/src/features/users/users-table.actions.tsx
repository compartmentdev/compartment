import { useEffect, useState, type JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import {
  readServerTableActionControlClassName,
  ServerTableActionError,
  ServerTableActions,
} from '../../components/server-table';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { Button } from '../../components/ui/button';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../../services/browser-users.service.types';
import type { UserActionHandler } from './user-actions';
import { UserAccessMenuItem, UserRemoveMenuItem } from './users-table.actions.menu-items';
import {
  readUserActionsMenuVisibleState,
  type UserActionsMenuPermissionState,
} from './users-table.actions.permissions';
import { buildUsersHref } from './users-query';

interface UserActionControlsProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onUserAction: UserActionHandler;
  organizationSlug: string;
  user: BrowserUsersUser;
}

interface ManageUserMenuItemProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  user: BrowserUsersUser;
}

interface UserActionsMenuProps extends UserActionControlsProps {
  menuState: UserActionsMenuPermissionState;
  setErrorMessage: (value: string | undefined) => void;
}

export function UserActionControls(props: Readonly<UserActionControlsProps>): JSX.Element {
  const { data, onNavigate, organizationSlug, user } = props;
  const [actionErrorMessage, setActionErrorMessage] = useState<string | undefined>(undefined);

  useEffect((): void => {
    setActionErrorMessage(undefined);
  }, [organizationSlug, user.access, user.email]);

  if (user.type === 'automation') {
    return <span className="text-[12px] text-muted-foreground">System-managed</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <ServerTableActions>
        <ViewUserButton data={data} onNavigate={onNavigate} user={user} />
        {readUserActionsMenu(props, setActionErrorMessage)}
      </ServerTableActions>
      <ServerTableActionError message={actionErrorMessage} />
    </div>
  );
}

function readUserActionsMenu(
  props: UserActionControlsProps,
  setErrorMessage: (value: string | undefined) => void,
): JSX.Element | null {
  const menuState: UserActionsMenuPermissionState = readUserActionsMenuVisibleState(
    props.data.currentOrganizationPermissions,
  );
  if (!menuState.hasActions) {
    return null;
  }

  return <UserActionsMenu {...props} menuState={menuState} setErrorMessage={setErrorMessage} />;
}

function UserActionsMenu(props: Readonly<UserActionsMenuProps>): JSX.Element {
  const { user } = props;
  return (
    <ServerTableActionsMenu ariaLabel={`Open actions for ${user.email}`}>
      {renderUserActionsMenuItems(props, props.menuState)}
    </ServerTableActionsMenu>
  );
}

function renderUserActionsMenuItems(
  props: Readonly<UserActionsMenuProps>,
  menuState: UserActionsMenuPermissionState,
): JSX.Element {
  return (
    <>
      {renderUserAccessMenuItem(props, menuState.canBlockUser)}
      {renderUserRemoveMenuItem(props, menuState.canRemoveUser)}
    </>
  );
}

function renderUserAccessMenuItem(props: Readonly<UserActionsMenuProps>, canBlockUser: boolean): JSX.Element {
  return (
    <UserAccessMenuItem
      canBlockUser={canBlockUser}
      onUserAction={props.onUserAction}
      organizationSlug={props.organizationSlug}
      setErrorMessage={props.setErrorMessage}
      user={props.user}
    />
  );
}

function renderUserRemoveMenuItem(props: Readonly<UserActionsMenuProps>, canRemoveUser: boolean): JSX.Element {
  return (
    <UserRemoveMenuItem
      canRemoveUser={canRemoveUser}
      onUserAction={props.onUserAction}
      organizationSlug={props.organizationSlug}
      setErrorMessage={props.setErrorMessage}
      user={props.user}
    />
  );
}

function ViewUserButton({ data, onNavigate, user }: Readonly<ManageUserMenuItemProps>): JSX.Element {
  return (
    <Button
      className={readServerTableActionControlClassName()}
      onClick={(): void => {
        onNavigate(buildUsersHref(data, { mode: 'detail', selectedUserEmail: user.email }));
      }}
      size="sm"
      type="button"
      variant="secondary"
    >
      View
    </Button>
  );
}
