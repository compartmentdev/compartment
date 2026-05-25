import type { JSX } from 'react';
import { canInviteBrowserUsers } from '../console/console-access';
import type { UserAccessPanelState } from './user-access-panel.state';
import { UserDetailDrawer } from './user-access-panel.detail-drawer';
import { InviteUserDrawer } from './user-access-panel.invite-drawer';

interface UserAccessPanelContentProps {
  state: UserAccessPanelState;
}

export function UserAccessPanelContent({ state }: Readonly<UserAccessPanelContentProps>): JSX.Element | null {
  if (state.data.mode === 'list') {
    return null;
  }

  if (state.data.mode === 'create') {
    return canInviteBrowserUsers(state.data.currentOrganizationPermissions) ? <InviteUserDrawer state={state} /> : null;
  }
  if (state.selectedAccess === null || state.data.selectedOrganizationSlug === null) {
    return null;
  }

  return <UserDetailDrawer access={state.selectedAccess} state={state} />;
}
