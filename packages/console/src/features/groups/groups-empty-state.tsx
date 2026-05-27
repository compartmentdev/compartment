import type { JSX } from 'react';
import { EmptyStateCard } from '../../components/empty-state-card';
import { groupsEmptyStateIconUrl } from '../../components/empty-state-icons';
import type { EmptyStateCardAction } from '../../components/empty-state-card.types';
import { Plus } from '../../components/ui/icons';
import { canManageBrowserGroups } from '../console/console-access';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface GroupsEmptyStateProps {
  state: GroupsPageState;
}

export function GroupsEmptyState({ state }: Readonly<GroupsEmptyStateProps>): JSX.Element {
  return (
    <EmptyStateCard
      action={readCreateGroupEmptyStateAction(state)}
      icon={groupsEmptyStateIconUrl}
      message="You do not have any groups."
    />
  );
}

export function shouldRenderGroupsEmptyState(state: GroupsPageState): boolean {
  return state.data.searchQuery.trim() === '' && state.data.totalGroups === 0;
}

function readCreateGroupEmptyStateAction(state: GroupsPageState): EmptyStateCardAction | undefined {
  if (!canManageBrowserGroups(state.data.currentOrganizationPermissions)) {
    return undefined;
  }

  return {
    icon: Plus,
    kind: 'button',
    label: 'Create group',
    onClick: (): void => {
      state.onNavigate(buildGroupsPageHref(state.data, null, 'create'));
    },
  };
}
