import type { UserAccessDetail } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { Button } from '../../components/ui/button';
import { Trash } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { readUserRemoveConfirmationSpec, removeUser, type UserRemoveConfirmationSpec } from './user-actions';
import type { UserAccessPanelState } from './user-access-panel.state';
import { buildUsersHref } from './users-query';

interface UserRemoveCardProps {
  access: UserAccessDetail;
  state: UserAccessPanelState;
}

interface UserRemoveActionProps {
  access: UserAccessDetail;
  mutation: UseMutationResult<void, Error, void>;
}

export function UserRemoveCard({ access, state }: Readonly<UserRemoveCardProps>): JSX.Element {
  const mutation: UseMutationResult<void, Error, void> = useUserRemoveMutation(access, state);

  return (
    <AccessAdditionalCard
      action={<UserRemoveAction access={access} mutation={mutation} />}
      description="Remove membership and revoke all direct grants for this user."
      title="Danger zone"
      tone="danger"
    />
  );
}

function UserRemoveAction({ access, mutation }: Readonly<UserRemoveActionProps>): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

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
        {mutation.isPending ? 'Removing...' : 'Remove user'}
      </Button>
      <UserRemoveDialog
        access={access}
        isDialogOpen={isDialogOpen}
        mutation={mutation}
        setIsDialogOpen={setIsDialogOpen}
      />
    </>
  );
}

function UserRemoveDialog({
  access,
  isDialogOpen,
  mutation,
  setIsDialogOpen,
}: Readonly<UserRemoveActionProps & { isDialogOpen: boolean; setIsDialogOpen: (open: boolean) => void }>): JSX.Element {
  const confirmation: UserRemoveConfirmationSpec = readUserRemoveConfirmationSpec(access.user.email);

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

function useUserRemoveMutation(
  access: UserAccessDetail,
  state: UserAccessPanelState,
): UseMutationResult<void, Error, void> {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> => await removeUser(access.user.email, organizationSlug),
    mutationKey: ['console-access', 'users', organizationSlug, access.user.email, 'remove'],
    onError: (error: Error): void => {
      state.setDrawerErrorMessage(error.message);
    },
    onSuccess: (): void => {
      state.onNavigate(buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null }));
    },
  });
}
