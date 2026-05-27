import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { EmptyStateCard } from '../../components/empty-state-card';
import { usersEmptyStateIconUrl } from '../../components/empty-state-icons';
import type { EmptyStateCardAction } from '../../components/empty-state-card.types';
import { MailPlus } from '../../components/ui/icons';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { canInviteBrowserUsers } from '../console/console-access';
import { buildUsersHref } from './users-query';

interface UsersEmptyStateProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function UsersEmptyState({ data, onNavigate }: Readonly<UsersEmptyStateProps>): JSX.Element {
  return (
    <EmptyStateCard
      action={readInviteUserEmptyStateAction(data, onNavigate)}
      icon={usersEmptyStateIconUrl}
      message="You do not have any invited users."
    />
  );
}

export function shouldRenderUsersEmptyState(data: BrowserUsersPageResult): boolean {
  return data.searchQuery.trim() === '' && (data.totalUsers === 0 || hasOnlyCurrentPrincipalUser(data));
}

function readInviteUserEmptyStateAction(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): EmptyStateCardAction | undefined {
  if (!canInviteBrowserUsers(data.currentOrganizationPermissions)) {
    return undefined;
  }

  return {
    icon: MailPlus,
    kind: 'button',
    label: 'Invite user',
    onClick: (): void => {
      onNavigate(buildUsersHref(data, { mode: 'create', page: 1, selectedUserEmail: null }));
    },
  };
}

function hasOnlyCurrentPrincipalUser(data: BrowserUsersPageResult): boolean {
  return data.totalUsers === 1 && data.users.length === 1 && data.users[0]?.email === data.principalEmail;
}
