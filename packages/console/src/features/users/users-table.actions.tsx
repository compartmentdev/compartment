import { useEffect, useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import {
  readServerTableActionControlClassName,
  ServerTableActionError,
  ServerTableActions,
} from '../../components/server-table';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { Button } from '../../components/ui/button';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../../services/browser-users.service.types';
import {
  readUserRemoveConfirmationSpec,
  type UserActionHandler,
  type UserRemoveConfirmationSpec,
} from './user-actions';
import { UserAccessMenuItem, UserRemoveMenuItem } from './users-table.actions.menu-items';
import { useUserRemoveMutation, type UserRemoveMutation } from './users-table.mutations';
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

interface UserRemoveDialogProps {
  email: string;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

interface UserActionsMenuContentProps {
  props: UserActionsMenuProps;
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
  return <UserActionsMenuContent props={props} />;
}

function UserActionsMenuContent({ props }: Readonly<UserActionsMenuContentProps>): JSX.Element {
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState<boolean>(false);
  const removeMutation: UserRemoveMutation = useUserActionsMenuRemoveMutation(props);
  const handleConfirm: () => void = (): void => {
    setIsRemoveDialogOpen(false);
    removeMutation.mutate();
  };

  return (
    <>
      <UserActionsDropdown
        isRemovePending={removeMutation.isPending}
        onRequestRemove={(): void => setIsRemoveDialogOpen(true)}
        props={props}
      />
      <UserRemoveDialog
        email={props.user.email}
        isOpen={isRemoveDialogOpen}
        isPending={removeMutation.isPending}
        onConfirm={handleConfirm}
        onOpenChange={setIsRemoveDialogOpen}
      />
    </>
  );
}

function useUserActionsMenuRemoveMutation(props: Readonly<UserActionsMenuProps>): UserRemoveMutation {
  return useUserRemoveMutation(props.onUserAction, props.organizationSlug, props.setErrorMessage, props.user);
}

function UserActionsDropdown({
  isRemovePending,
  onRequestRemove,
  props,
}: Readonly<{ isRemovePending: boolean; onRequestRemove: () => void; props: UserActionsMenuProps }>): JSX.Element {
  return (
    <ServerTableActionsMenu ariaLabel={`Open actions for ${props.user.email}`}>
      {renderUserActionsMenuItems(props, props.menuState, isRemovePending, onRequestRemove)}
    </ServerTableActionsMenu>
  );
}

function renderUserActionsMenuItems(
  props: Readonly<UserActionsMenuProps>,
  menuState: UserActionsMenuPermissionState,
  isRemovePending: boolean,
  onRequestRemove: () => void,
): JSX.Element {
  return (
    <>
      {renderUserAccessMenuItem(props, menuState.canBlockUser)}
      {renderUserRemoveMenuItem(props, menuState.canRemoveUser, isRemovePending, onRequestRemove)}
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

function renderUserRemoveMenuItem(
  props: Readonly<UserActionsMenuProps>,
  canRemoveUser: boolean,
  isPending: boolean,
  onRequestRemove: () => void,
): JSX.Element {
  return (
    <UserRemoveMenuItem
      canRemoveUser={canRemoveUser}
      isPending={isPending}
      onSelect={onRequestRemove}
      onUserAction={props.onUserAction}
      organizationSlug={props.organizationSlug}
      setErrorMessage={props.setErrorMessage}
      user={props.user}
    />
  );
}

function UserRemoveDialog({
  email,
  isOpen,
  isPending,
  onConfirm,
  onOpenChange,
}: Readonly<UserRemoveDialogProps>): JSX.Element {
  const confirmation: UserRemoveConfirmationSpec = readUserRemoveConfirmationSpec(email);

  return (
    <ConfirmationDialog
      confirmLabel={confirmation.confirmLabel}
      description={confirmation.description}
      expectedValue={confirmation.expectedValue}
      inputLabel={confirmation.inputLabel}
      inputPlaceholder={confirmation.inputPlaceholder}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={isOpen}
      title={confirmation.title}
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
