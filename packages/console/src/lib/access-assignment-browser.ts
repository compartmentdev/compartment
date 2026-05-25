import {
  accessAssignmentResponseSchema,
  accessGroupMemberListResponseSchema,
  compartmentAssignmentsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentGroupsPathname,
  type AccessAssignmentScopeTarget,
} from '@compartment/contracts/browser';
import { requestBrowserApi } from './browser-api';
import { normalizeBrowserActionErrorMessage, type BrowserActionFieldLabelMap } from './browser-action-error';
import { redirectBrowserWindow } from './browser-redirect';

export type BrowserAccessPageSetter<T> = (value: T | ((current: T) => T)) => void;
type BrowserAccessErrorSetter = (message: string | undefined) => void;
type BrowserAccessPageErrorUpdater<T> = (current: T, message: string) => T;

type BrowserAccessAssignmentSubject =
  | { groupId: string; subjectType: 'group' }
  | { principalEmail: string; subjectType: 'principal' };

export type BrowserAccessAssignmentCreateScope =
  | { scopeType: 'organization' }
  | { projectName: string; scopeType: 'project' }
  | { environmentName: string; projectName: string; scopeType: 'environment' };

interface BrowserAccessAssignmentCreateActionInput<T> {
  currentOrganization: string;
  fieldLabels?: BrowserActionFieldLabelMap | undefined;
  failureMessage: string;
  refreshPageData: () => Promise<void>;
  roleId: string;
  scopes: BrowserAccessAssignmentCreateScope[];
  setData: BrowserAccessPageSetter<T>;
  setErrorMessage?: BrowserAccessErrorSetter | undefined;
  subject: BrowserAccessAssignmentSubject;
  updateError?: BrowserAccessPageErrorUpdater<T> | undefined;
}

interface BrowserAccessActionOptions<T> {
  failureMessage: string;
  fieldLabels?: BrowserActionFieldLabelMap | undefined;
  setErrorMessage?: BrowserAccessErrorSetter | undefined;
  updateError?: BrowserAccessPageErrorUpdater<T> | undefined;
}

export function formatBrowserAccessAssignmentScope(scope: AccessAssignmentScopeTarget): string {
  if (scope.scopeType === 'organization') {
    return 'Organization';
  }
  if (scope.scopeType === 'project') {
    return `Project: ${scope.projectName}`;
  }

  return `Environment: ${scope.projectName}/${scope.environmentName}`;
}

export async function addBrowserAccessGroupMember(
  currentOrganization: string,
  groupId: string,
  email: string,
): Promise<void> {
  await requestBrowserApi(
    `${compartmentGroupsPathname}/${groupId}${compartmentGroupMembersPathnameSuffix}`,
    accessGroupMemberListResponseSchema,
    {
      currentOrganization,
      json: { email },
      method: 'POST',
    },
  );
}

export async function removeBrowserAccessGroupMember(
  currentOrganization: string,
  groupId: string,
  email: string,
): Promise<void> {
  await requestBrowserApi(
    `${compartmentGroupsPathname}/${groupId}${compartmentGroupMembersPathnameSuffix}/${encodeURIComponent(email)}`,
    accessGroupMemberListResponseSchema,
    {
      currentOrganization,
      method: 'DELETE',
    },
  );
}

export async function runBrowserAccessAssignmentCreateAction<T>(
  input: BrowserAccessAssignmentCreateActionInput<T>,
): Promise<boolean> {
  return await runBrowserAccessAction(
    input.setData,
    input.refreshPageData,
    async (): Promise<void> =>
      await createBrowserAccessAssignments(input.currentOrganization, input.roleId, input.scopes, input.subject),
    {
      failureMessage: input.failureMessage,
      fieldLabels: input.fieldLabels,
      setErrorMessage: input.setErrorMessage,
      updateError: input.updateError,
    },
  );
}

async function createBrowserAccessAssignments(
  currentOrganization: string,
  roleId: string,
  scopes: BrowserAccessAssignmentCreateScope[],
  subject: BrowserAccessAssignmentSubject,
): Promise<void> {
  for (const scope of scopes) {
    await requestBrowserApi(compartmentAssignmentsPathname, accessAssignmentResponseSchema, {
      json: {
        roleId,
        scope: buildBrowserAccessAssignmentScope(scope),
        subject,
      },
      currentOrganization,
      method: 'POST',
    });
  }
}

export async function deleteBrowserAccessAssignment(currentOrganization: string, assignmentId: string): Promise<void> {
  await requestBrowserApi(`${compartmentAssignmentsPathname}/${assignmentId}`, accessAssignmentResponseSchema, {
    currentOrganization,
    method: 'DELETE',
  });
}

export function requireSelectedOrganizationSlug(selectedOrganizationSlug: string | null): string {
  if (selectedOrganizationSlug === null) {
    throw new Error('Expected selected organization.');
  }

  return selectedOrganizationSlug;
}

export async function runBrowserAccessAction<T>(
  setData: BrowserAccessPageSetter<T>,
  refreshPageData: () => Promise<void>,
  action: () => Promise<void>,
  options: BrowserAccessActionOptions<T>,
): Promise<boolean> {
  options.setErrorMessage?.(undefined);
  try {
    await action();
    await refreshPageData();
    return true;
  } catch (error) {
    if (error instanceof Error && redirectBrowserWindow(error)) {
      return false;
    }

    handleBrowserAccessActionError(setData, error instanceof Error ? error : undefined, options);
    return false;
  }
}

function buildBrowserAccessAssignmentScope(scope: BrowserAccessAssignmentCreateScope): AccessAssignmentScopeTarget {
  if (scope.scopeType === 'organization') {
    return { scopeType: 'organization' };
  }
  if (scope.scopeType === 'project') {
    return { projectName: scope.projectName, scopeType: 'project' };
  }

  return {
    environmentName: scope.environmentName,
    projectName: scope.projectName,
    scopeType: 'environment',
  };
}

function handleBrowserAccessActionError<T>(
  setData: BrowserAccessPageSetter<T>,
  error: Error | undefined,
  options: BrowserAccessActionOptions<T>,
): void {
  const errorMessage: string = normalizeBrowserActionErrorMessage(error, options.failureMessage, options.fieldLabels);
  if (options.setErrorMessage !== undefined) {
    options.setErrorMessage(errorMessage);
    return;
  }
  if (options.updateError !== undefined) {
    setData((current: T): T => options.updateError!(current, errorMessage));
  }
}
