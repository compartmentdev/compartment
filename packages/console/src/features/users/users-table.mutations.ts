import type { UseMutationResult } from '@tanstack/react-query';
import { normalizeBrowserActionError } from '../../lib/browser-action-error';
import { useBrowserMutation } from '../../lib/browser-query-client';
import type { BrowserUsersUser } from '../../services/browser-users.service.types';
import { blockUser, removeUser, unblockUser, type UserActionHandler } from './user-actions';

export type UserAccessMutation = UseMutationResult<void, Error, void>;
export type UserRemoveMutation = UseMutationResult<void, Error, void>;

export function useUserAccessMutation(
  onUserAction: UserActionHandler,
  organizationSlug: string,
  setErrorMessage: (value: string | undefined) => void,
  user: BrowserUsersUser,
): UserAccessMutation {
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> => await updateUserAccess(user, organizationSlug),
    mutationKey: readUserAccessMutationKey(user, organizationSlug),
    onError: (error: Error): void => {
      setErrorMessage(normalizeBrowserActionError(error, 'User action failed.').message);
    },
    onSuccess: async (): Promise<void> => {
      await onUserAction();
    },
  });
}

async function updateUserAccess(user: BrowserUsersUser, organizationSlug: string): Promise<void> {
  if (user.access === 'blocked') {
    await unblockUser(user.email, organizationSlug);
    return;
  }

  await blockUser(user.email, organizationSlug);
}

function readUserAccessMutationKey(user: BrowserUsersUser, organizationSlug: string): readonly string[] {
  return ['console-access', 'users', organizationSlug, user.email, user.access === 'blocked' ? 'unblock' : 'block'];
}

export function useUserRemoveMutation(
  onUserAction: UserActionHandler,
  organizationSlug: string,
  setErrorMessage: (value: string | undefined) => void,
  user: BrowserUsersUser,
): UserRemoveMutation {
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> => await removeUser(user.email, organizationSlug),
    mutationKey: ['console-access', 'users', organizationSlug, user.email, 'remove'],
    onError: (error: Error): void => {
      setErrorMessage(normalizeBrowserActionError(error, 'User action failed.').message);
    },
    onSuccess: async (): Promise<void> => {
      await onUserAction();
    },
  });
}
