import type { PermissionKey } from '@compartment/contracts/browser';
import { canBlockBrowserUsers, canRemoveBrowserUsers } from '../console/console-access';

export interface UserActionsMenuPermissionState {
  canBlockUser: boolean;
  canRemoveUser: boolean;
  hasActions: boolean;
}

export function readUserActionsMenuVisibleState(permissions: PermissionKey[]): UserActionsMenuPermissionState {
  const state: Omit<UserActionsMenuPermissionState, 'hasActions'> = {
    canBlockUser: canBlockBrowserUsers(permissions),
    canRemoveUser: canRemoveBrowserUsers(permissions),
  };

  return {
    ...state,
    hasActions: state.canBlockUser || state.canRemoveUser,
  };
}
