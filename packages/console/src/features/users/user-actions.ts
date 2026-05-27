import { organizationUserResponseSchema, removeUserResponseSchema } from '@compartment/contracts/browser';
import { buildUserApiPath, buildUserBlockApiPath, buildUserUnblockApiPath } from '../../routes/users/users-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';

export type UserActionHandler = (error?: Error) => Promise<void>;

export interface UserRemoveConfirmationSpec {
  confirmLabel: 'Remove user';
  description: string;
  expectedValue: string;
  inputLabel: 'User email';
  inputPlaceholder: string;
  title: 'Remove user';
}

export function readUserRemoveConfirmationSpec(email: string): UserRemoveConfirmationSpec {
  return {
    confirmLabel: 'Remove user',
    description: `Type ${email} to remove this user.`,
    expectedValue: email,
    inputLabel: 'User email',
    inputPlaceholder: email,
    title: 'Remove user',
  };
}

export async function removeUser(email: string, organizationSlug: string): Promise<void> {
  await requestBrowserApi(buildUserApiPath(email), removeUserResponseSchema, {
    currentOrganization: organizationSlug,
    method: 'DELETE',
  });
}

export async function blockUser(email: string, organizationSlug: string): Promise<void> {
  await requestBrowserApi(buildUserBlockApiPath(email), organizationUserResponseSchema, {
    currentOrganization: organizationSlug,
    method: 'POST',
  });
}

export async function unblockUser(email: string, organizationSlug: string): Promise<void> {
  await requestBrowserApi(buildUserUnblockApiPath(email), organizationUserResponseSchema, {
    currentOrganization: organizationSlug,
    method: 'POST',
  });
}
