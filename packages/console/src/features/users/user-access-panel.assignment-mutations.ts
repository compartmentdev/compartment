import type { UseMutationResult } from '@tanstack/react-query';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { handleUserAccessAssignmentCreate, handleUserAccessAssignmentDelete } from './user-access-panel.actions';
import type { UserDirectAssignmentRowProps, UserDirectAssignmentsCardProps } from './user-access-panel.assignments';

export type UserAssignmentMutation = UseMutationResult<void, Error, void>;

export function useUserAssignmentCreateMutation(props: UserDirectAssignmentsCardProps): UserAssignmentMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleUserAccessAssignmentCreate(
        props.data,
        props.access.user.email,
        props.roleId,
        props.scopeType,
        props.projectNames,
        props.environmentValues,
        props.setData,
        props.setErrorMessage,
        props.setEnvironmentValues,
        props.setProjectNames,
      ),
    mutationKey: ['console-access', 'users', organizationSlug, props.access.user.email, 'assignments', 'create'],
  });
}

export function useUserAssignmentDeleteMutation(props: UserDirectAssignmentRowProps): UserAssignmentMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleUserAccessAssignmentDelete(props.data, props.assignment.id, props.setData, props.setErrorMessage),
    mutationKey: ['console-access', 'users', organizationSlug, 'assignments', props.assignment.id, 'delete'],
  });
}
