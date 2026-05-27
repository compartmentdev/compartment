import type { JSX } from 'react';
import { AccessDrawerShell } from '../access/access-ui';
import { canInviteBrowserUsers } from '../console/console-access';
import type { UserAccessPanelState } from './user-access-panel.state';
import { UserDetailDrawerContent, UserDetailDrawerHeader } from './user-access-panel.detail-drawer';
import type { UserAccessDetail } from '@compartment/contracts/browser';
import {
  type InviteUserMutation,
  InviteUserDrawerContent,
  InviteUserDrawerFooter,
  InviteUserDrawerHeader,
  useInviteUserMutation,
} from './user-access-panel.invite-drawer';
import { buildUsersHref } from './users-query';

interface UserAccessPanelContentProps {
  state: UserAccessPanelState;
}

export function UserAccessPanelContent({ state }: Readonly<UserAccessPanelContentProps>): JSX.Element | null {
  const inviteMutation: InviteUserMutation = useInviteUserMutation(state);

  if (state.data.mode === 'list') {
    return null;
  }

  if (state.data.mode === 'create') {
    return canInviteBrowserUsers(state.data.currentOrganizationPermissions)
      ? renderInviteUserDrawer(inviteMutation, state)
      : null;
  }
  if (state.selectedAccess === null || state.data.selectedOrganizationSlug === null) {
    return null;
  }

  return renderUserDetailDrawer(state.selectedAccess, state);
}

function renderInviteUserDrawer(mutation: InviteUserMutation, state: UserAccessPanelState): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
      footer={<InviteUserDrawerFooter mutation={mutation} state={state} />}
      header={<InviteUserDrawerHeader state={state} />}
      onNavigate={state.onNavigate}
      title="Invite user"
    >
      <InviteUserDrawerContent mutation={mutation} state={state} />
    </AccessDrawerShell>
  );
}

function renderUserDetailDrawer(access: UserAccessDetail, state: UserAccessPanelState): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
      header={<UserDetailDrawerHeader state={state} />}
      onNavigate={state.onNavigate}
      title={access.user.email}
    >
      <UserDetailDrawerContent access={access} state={state} />
    </AccessDrawerShell>
  );
}
