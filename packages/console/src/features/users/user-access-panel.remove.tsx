import type { UserAccessDetail } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { type FormEvent, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { removeUser } from './user-actions';
import type { UserAccessPanelState } from './user-access-panel.state';
import { buildUsersHref } from './users-query';

interface UserRemoveCardProps {
  access: UserAccessDetail;
  state: UserAccessPanelState;
}

export function UserRemoveCard({ access, state }: Readonly<UserRemoveCardProps>): JSX.Element {
  const mutation: UseMutationResult<void, Error, void> = useUserRemoveMutation(access, state);

  return (
    <AccessAdditionalCard
      action={
        <form onSubmit={createUserRemoveSubmitHandler(access, mutation)}>
          <Button
            className={readAccessDangerActionButtonClassName()}
            disabled={mutation.isPending}
            size="sm"
            type="submit"
            variant="outline"
          >
            {mutation.isPending ? 'Removing...' : 'Remove user'}
          </Button>
        </form>
      }
      description="Remove membership and revoke all direct grants for this user."
      title="Danger zone"
      tone="danger"
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

function createUserRemoveSubmitHandler(
  access: UserAccessDetail,
  mutation: UseMutationResult<void, Error, void>,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mutation.isPending || window.prompt(`Type ${access.user.email} to remove this user.`) !== access.user.email) {
      return;
    }

    mutation.mutate();
  };
}
