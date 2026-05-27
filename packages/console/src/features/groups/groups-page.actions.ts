import {
  accessGroupResponseSchema,
  compartmentGroupsPathname,
  type AccessGroupResponse,
  type AccessAssignmentScopeType,
} from '@compartment/contracts/browser';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { requestBrowserApi } from '../../lib/browser-api';
import {
  addBrowserAccessGroupMember,
  deleteBrowserAccessAssignment,
  removeBrowserAccessGroupMember,
  requireSelectedOrganizationSlug,
  runBrowserAccessAssignmentCreateAction,
  runBrowserAccessAction,
  type BrowserAccessPageSetter,
} from '../../lib/access-assignment-browser';
import { normalizeOptionalDescription } from '../access/access-description.helpers';
import { readAccessAssignmentCreateScopes } from '../access/access-assignment-create-scopes';
import { invalidateGroupsAccessQueries } from './groups-query-state';

export type GroupsPageSetter = BrowserAccessPageSetter<BrowserGroupsPageResult>;
type GroupDrawerErrorSetter = (value: string | undefined) => void;

export interface GroupDeleteConfirmationSpec {
  confirmLabel: 'Delete group';
  description: string;
  expectedValue: string;
  inputLabel: 'Group name';
  inputPlaceholder: string;
  title: 'Delete group';
}

const groupActionFailureMessage: string = 'Group action failed.';

export async function handleGroupCreateAction(
  data: BrowserGroupsPageResult,
  description: string,
  name: string,
): Promise<AccessGroupResponse> {
  return await requestBrowserApi(compartmentGroupsPathname, accessGroupResponseSchema, {
    currentOrganization: requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
    json: {
      description: normalizeOptionalDescription(description),
      name,
    },
    method: 'POST',
  });
}

export async function handleGroupRenameAction(
  data: BrowserGroupsPageResult,
  groupId: string,
  description: string,
  name: string,
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
): Promise<boolean> {
  return await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    async (): Promise<void> => await updateGroup(groupId, description, name, data.selectedOrganizationSlug),
    {
      failureMessage: groupActionFailureMessage,
      setErrorMessage,
    },
  );
}

export async function handleGroupDeleteAction(
  data: BrowserGroupsPageResult,
  groupId: string,
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
): Promise<boolean> {
  return await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    async (): Promise<void> => {
      await requestBrowserApi(`${compartmentGroupsPathname}/${groupId}`, accessGroupResponseSchema, {
        currentOrganization: requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
        method: 'DELETE',
      });
    },
    {
      failureMessage: groupActionFailureMessage,
      setErrorMessage,
    },
  );
}

export function readGroupDeleteConfirmationSpec(groupName: string): GroupDeleteConfirmationSpec {
  return {
    confirmLabel: 'Delete group',
    description: `Type ${groupName} to delete this group.`,
    expectedValue: groupName,
    inputLabel: 'Group name',
    inputPlaceholder: groupName,
    title: 'Delete group',
  };
}

export async function handleGroupMemberAddAction(
  data: BrowserGroupsPageResult,
  groupId: string,
  email: string,
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
  setEmail: (value: string) => void,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    async (): Promise<void> => {
      await addBrowserAccessGroupMember(requireSelectedOrganizationSlug(data.selectedOrganizationSlug), groupId, email);
      setEmail('');
    },
    {
      failureMessage: groupActionFailureMessage,
      setErrorMessage,
    },
  );
}

export async function handleGroupMemberDeleteAction(
  data: BrowserGroupsPageResult,
  groupId: string,
  email: string,
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    async (): Promise<void> =>
      await removeBrowserAccessGroupMember(
        requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
        groupId,
        email,
      ),
    {
      failureMessage: groupActionFailureMessage,
      setErrorMessage,
    },
  );
}

export async function handleGroupAssignmentCreateAction(
  data: BrowserGroupsPageResult,
  groupId: string,
  roleId: string,
  scopeType: AccessAssignmentScopeType,
  projectNames: string[],
  environmentValues: string[],
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAssignmentCreateAction({
    currentOrganization: requireSelectedOrganizationSlug(data.selectedOrganizationSlug),
    failureMessage: groupActionFailureMessage,
    refreshPageData: async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    roleId,
    scopes: readAccessAssignmentCreateScopes(scopeType, projectNames, environmentValues),
    setData,
    setErrorMessage,
    subject: readGroupAssignmentSubject(groupId),
  });
}

export async function handleGroupAssignmentDeleteAction(
  data: BrowserGroupsPageResult,
  assignmentId: string,
  setData: GroupsPageSetter,
  setErrorMessage: GroupDrawerErrorSetter,
): Promise<void> {
  await runBrowserAccessAction(
    setData,
    async (): Promise<void> => await invalidateGroupsAccessQueries(data),
    async (): Promise<void> =>
      await deleteBrowserAccessAssignment(requireSelectedOrganizationSlug(data.selectedOrganizationSlug), assignmentId),
    {
      failureMessage: groupActionFailureMessage,
      setErrorMessage,
    },
  );
}

function readGroupAssignmentSubject(groupId: string): { groupId: string; subjectType: 'group' } {
  return { groupId, subjectType: 'group' };
}

async function updateGroup(
  groupId: string,
  description: string,
  name: string,
  selectedOrganizationSlug: string | null,
): Promise<void> {
  await requestBrowserApi(`${compartmentGroupsPathname}/${groupId}`, accessGroupResponseSchema, {
    currentOrganization: requireSelectedOrganizationSlug(selectedOrganizationSlug),
    json: { description: normalizeOptionalDescription(description), name },
    method: 'PATCH',
  });
}
