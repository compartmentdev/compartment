import { organizationUserResponseSchema, removeUserResponseSchema } from '@compartment/contracts/browser';
import { buildUserApiPath, buildUserBlockApiPath, buildUserUnblockApiPath } from '../../routes/users/users-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';

export type UserActionHandler = (error?: Error) => Promise<void>;

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
