import { type AccessAssignmentScopeType } from '@compartment/contracts/browser';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import {
  addBrowserAccessGroupMember,
  deleteBrowserAccessAssignment,
  removeBrowserAccessGroupMember,
  requireSelectedOrganizationSlug,
  runBrowserAccessAssignmentCreateAction,
  runBrowserAccessAction,
  type BrowserAccessPageSetter,
} from '../../lib/access-assignment-browser';
import { readAccessAssignmentCreateScopes } from '../access/access-assignment-create-scopes';
import { resetAccessScopeSelectionsAfterCreate } from '../access/access-scope-selection';
import { invalidateUserAccessQueries } from './users-query-invalidation';

export type UserAccessPanelSetter = BrowserAccessPageSetter<BrowserUsersPageResult>;
type UserAccessDrawerErrorSetter = (value: string | undefined) => void;

const userAccessActionFailureMessage: string = 'User access action failed.';

export async function handleUserAccessGroupAdd(
  data: BrowserUsersPageResult,
  email: string,
  groupId: string,
  setData: UserAccessPanelSetter,
  setErrorMessage: UserAccessDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateUserAccessQueries(data),
    async (): Promise<void> =>
      await addBrowserAccessGroupMember(requireSelectedOrganizationSlug(data.selectedOrganizationSlug), groupId, email),
    {
      failureMessage: userAccessActionFailureMessage,
      setErrorMessage,
    },
  );
}

export async function handleUserAccessGroupRemove(
  data: BrowserUsersPageResult,
  email: string,
  groupId: string,
  setData: UserAccessPanelSetter,
  setErrorMessage: UserAccessDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateUserAccessQueries(data),
    async (): Promise<void> =>
      await removeBrowserAccessGroupMember(
        requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
        groupId,
        email,
      ),
    {
      failureMessage: userAccessActionFailureMessage,
      setErrorMessage,
    },
  );
}

export async function handleUserAccessAssignmentCreate(
  data: BrowserUsersPageResult,
  email: string,
  roleId: string,
  scopeType: AccessAssignmentScopeType,
  projectNames: string[],
  environmentValues: string[],
  setData: UserAccessPanelSetter,
  setErrorMessage: UserAccessDrawerErrorSetter,
  setEnvironmentValues: (value: string[]) => void,
  setProjectNames: (value: string[]) => void,
): Promise<void> {
  const didCreate: boolean = await runBrowserAccessAssignmentCreateAction({
    currentOrganization: requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
    failureMessage: userAccessActionFailureMessage,
    refreshPageData: async (): Promise<void> => await invalidateUserAccessQueries(data),
    roleId,
    scopes: readAccessAssignmentCreateScopes(scopeType, projectNames, environmentValues),
    setData,
    setErrorMessage,
    subject: readPrincipalAssignmentSubject(email),
  });

  resetAccessScopeSelectionsAfterCreate(didCreate, setEnvironmentValues, setProjectNames);
}

export async function handleUserAccessAssignmentDelete(
  data: BrowserUsersPageResult,
  assignmentId: string,
  setData: UserAccessPanelSetter,
  setErrorMessage: UserAccessDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateUserAccessQueries(data),
    async (): Promise<void> =>
      await deleteBrowserAccessAssignment(requireSelectedOrganizationSlug(data.selectedOrganizationSlug), assignmentId),
    {
      failureMessage: userAccessActionFailureMessage,
      setErrorMessage,
    },
  );
}

function readPrincipalAssignmentSubject(principalEmail: string): { principalEmail: string; subjectType: 'principal' } {
  return { principalEmail, subjectType: 'principal' };
}
