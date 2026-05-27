import { type AccessGroupListRow } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { Button } from '../../components/ui/button';
import { Trash } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { buildGroupsPageHref } from './groups-page.href';
import {
  handleGroupDeleteAction,
  readGroupDeleteConfirmationSpec,
  type GroupDeleteConfirmationSpec,
} from './groups-page.actions';
import type { GroupsPageState } from './groups-page.state';

interface GroupDeleteActionProps {
  selectedGroup: AccessGroupListRow;
  state: GroupsPageState;
}

interface GroupDeleteDialogProps {
  groupName: string;
  isDialogOpen: boolean;
  mutation: UseMutationResult<boolean, Error, void>;
  setIsDialogOpen: (value: boolean) => void;
}

export function GroupDeleteAction({ selectedGroup, state }: Readonly<GroupDeleteActionProps>): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const mutation: UseMutationResult<boolean, Error, void> = useDeleteGroupMutation(selectedGroup, state);

  return (
    <>
      <Button
        className={readAccessDangerActionButtonClassName()}
        disabled={mutation.isPending}
        onClick={(): void => setIsDialogOpen(true)}
        size="sm"
        type="button"
        variant="destructive"
      >
        <Trash aria-hidden="true" />
        {mutation.isPending ? 'Deleting...' : 'Delete group'}
      </Button>
      <GroupDeleteDialog
        groupName={selectedGroup.name}
        isDialogOpen={isDialogOpen}
        mutation={mutation}
        setIsDialogOpen={setIsDialogOpen}
      />
    </>
  );
}

function GroupDeleteDialog({
  groupName,
  isDialogOpen,
  mutation,
  setIsDialogOpen,
}: Readonly<GroupDeleteDialogProps>): JSX.Element {
  const confirmation: GroupDeleteConfirmationSpec = readGroupDeleteConfirmationSpec(groupName);

  return (
    <ConfirmationDialog
      confirmLabel={confirmation.confirmLabel}
      description={confirmation.description}
      expectedValue={confirmation.expectedValue}
      inputLabel={confirmation.inputLabel}
      inputPlaceholder={confirmation.inputPlaceholder}
      isPending={mutation.isPending}
      onConfirm={(): void => {
        setIsDialogOpen(false);
        mutation.mutate();
      }}
      onOpenChange={setIsDialogOpen}
      open={isDialogOpen}
      title={confirmation.title}
    />
  );
}

function useDeleteGroupMutation(
  selectedGroup: AccessGroupListRow,
  state: GroupsPageState,
): UseMutationResult<boolean, Error, void> {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);

  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> =>
      await handleGroupDeleteAction(state.data, selectedGroup.id, state.setData, state.setDrawerErrorMessage),
    mutationKey: ['console-access', 'groups', organizationSlug, selectedGroup.id, 'delete'],
    onSuccess: (didDelete: boolean): void => {
      if (didDelete) {
        state.onNavigate(buildGroupsPageHref(state.data, null));
      }
    },
  });
}
