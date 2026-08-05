import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { EmptyStateCard } from '../../components/empty-state-card';
import type { EmptyStateCardButtonAction } from '../../components/empty-state-card.types';
import { usersEmptyStateIconUrl } from '../../components/empty-state-icons';
import { MailPlus, type LucideIcon } from '../../components/ui/icons';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { canInviteBrowserUsers, canReadBrowserUsers } from '../console/console-access';
import { buildUsersHref } from './users-query';
import type { UsersInviteOnlyStateProps } from './users-invite-only-state.types';

class InviteUserAction implements EmptyStateCardButtonAction {
  readonly icon: LucideIcon = MailPlus;
  readonly kind: 'button' = 'button';
  readonly label: string = 'Invite user';

  constructor(readonly onClick: () => void) {}
}

export function UsersInviteOnlyState({ data, onNavigate }: Readonly<UsersInviteOnlyStateProps>): JSX.Element {
  return (
    <EmptyStateCard
      action={readInviteUserAction(data, onNavigate)}
      icon={usersEmptyStateIconUrl}
      message="You can invite users, but cannot view the member list."
    />
  );
}

export function shouldRenderUsersInviteOnlyState(data: BrowserUsersPageResult): boolean {
  return (
    canInviteBrowserUsers(data.currentOrganizationPermissions) &&
    !canReadBrowserUsers(data.currentOrganizationPermissions)
  );
}

function readInviteUserAction(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): EmptyStateCardButtonAction {
  return new InviteUserAction((): void => {
    onNavigate(buildUsersHref(data, { mode: 'create', page: 1, selectedUserEmail: null }));
  });
}
