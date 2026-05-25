import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import type { UserAccessPanelSetter } from './user-access-panel.actions';
import { UserAccessPanelContent } from './user-access-panel.sections';
import { type UserAccessPanelState, useUserAccessPanelState } from './user-access-panel.state';

interface UserAccessPanelProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  setData: UserAccessPanelSetter;
}

export function UserAccessPanel({ data, onNavigate, setData }: Readonly<UserAccessPanelProps>): JSX.Element {
  const state: UserAccessPanelState = useUserAccessPanelState(data, onNavigate, setData);

  return <UserAccessPanelContent state={state} />;
}
