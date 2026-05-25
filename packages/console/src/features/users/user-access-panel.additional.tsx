import type { UserAccessDetail } from '@compartment/contracts/browser';
import { type JSX } from 'react';
import { AccessDrawerSection } from '../access/access-ui';
import { canRemoveBrowserUsers } from '../console/console-access';
import type { UserAccessPanelState } from './user-access-panel.state';
import { UserRemoveCard } from './user-access-panel.remove';

interface UserAdditionalSectionProps {
  access: UserAccessDetail;
  state: UserAccessPanelState;
}

export function UserAdditionalSection({ access, state }: Readonly<UserAdditionalSectionProps>): JSX.Element | null {
  if (!shouldShowUserAdditionalSection(access, state)) {
    return null;
  }

  return (
    <AccessDrawerSection title="Additional">
      <div className="space-y-3">
        <UserRemoveCard access={access} state={state} />
      </div>
    </AccessDrawerSection>
  );
}

function shouldShowUserAdditionalSection(access: UserAccessDetail, state: UserAccessPanelState): boolean {
  return access.user.type !== 'automation' && canRemoveBrowserUsers(state.data.currentOrganizationPermissions);
}
