import type { JSX } from 'react';
import { EmptyStateCard } from '../../components/empty-state-card';
import type { EmptyStateCardAction } from '../../components/empty-state-card.types';
import { Drama, Plus } from '../../components/ui/icons';
import { canManageBrowserRoles } from '../console/console-access';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

interface RolesEmptyStateProps {
  state: RolesPageState;
}

export function RolesEmptyState({ state }: Readonly<RolesEmptyStateProps>): JSX.Element {
  return (
    <EmptyStateCard
      action={readCreateRoleEmptyStateAction(state)}
      icon={Drama}
      iconClassName="text-[var(--chart-2)]"
      message="You do not have any roles in the Compartment."
    />
  );
}

export function shouldRenderRolesEmptyState(state: RolesPageState, searchQuery: string): boolean {
  return searchQuery.trim() === '' && state.data.roles.length === 0;
}

function readCreateRoleEmptyStateAction(state: RolesPageState): EmptyStateCardAction | undefined {
  if (!canManageBrowserRoles(state.data.currentOrganizationPermissions)) {
    return undefined;
  }

  return {
    icon: Plus,
    kind: 'button',
    label: 'Create role',
    onClick: (): void => {
      state.onNavigate(buildRolesPageHref(state.data, { mode: 'create' }));
    },
  };
}
