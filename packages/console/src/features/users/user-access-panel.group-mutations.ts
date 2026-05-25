import type { AccessGroupSummary, UserAccessDetail } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import {
  handleUserAccessGroupAdd,
  handleUserAccessGroupRemove,
  type UserAccessPanelSetter,
} from './user-access-panel.actions';

interface UserGroupAddMutationProps {
  access: UserAccessDetail;
  data: BrowserUsersPageResult;
  groupId: string;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}

interface UserGroupRemoveMutationProps {
  data: BrowserUsersPageResult;
  email: string;
  group: AccessGroupSummary;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}

export type UserGroupMutation = UseMutationResult<void, Error, void>;

export function useUserGroupAddMutation(props: UserGroupAddMutationProps): UserGroupMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleUserAccessGroupAdd(
        props.data,
        props.access.user.email,
        props.groupId,
        props.setData,
        props.setErrorMessage,
      ),
    mutationKey: ['console-access', 'users', organizationSlug, props.access.user.email, 'groups', 'add'],
  });
}

export function useUserGroupRemoveMutation(props: UserGroupRemoveMutationProps): UserGroupMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleUserAccessGroupRemove(props.data, props.email, props.group.id, props.setData, props.setErrorMessage),
    mutationKey: ['console-access', 'users', organizationSlug, props.email, 'groups', props.group.id, 'remove'],
  });
}
