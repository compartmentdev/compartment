import type { UseMutationResult } from '@tanstack/react-query';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { handleGroupAssignmentCreateAction, handleGroupAssignmentDeleteAction } from './groups-page.actions';
import type { GroupAssignmentRowProps, GroupAssignmentsCardProps } from './groups-page.assignments';

export type GroupAssignmentMutation = UseMutationResult<void, Error, void>;

export function useGroupAssignmentCreateMutation(props: GroupAssignmentsCardProps): GroupAssignmentMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleGroupAssignmentCreateAction(
        props.data,
        props.selectedGroup.id,
        props.roleId,
        props.scopeType,
        props.projectNames,
        props.environmentValues,
        props.setData,
        props.setErrorMessage,
      ),
    mutationKey: ['console-access', 'groups', organizationSlug, props.selectedGroup.id, 'assignments', 'create'],
  });
}

export function useGroupAssignmentDeleteMutation(props: GroupAssignmentRowProps): GroupAssignmentMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleGroupAssignmentDeleteAction(props.data, props.assignment.id, props.setData, props.setErrorMessage),
    mutationKey: ['console-access', 'groups', organizationSlug, 'assignments', props.assignment.id, 'delete'],
  });
}
