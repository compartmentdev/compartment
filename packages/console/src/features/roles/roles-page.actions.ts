import {
  accessRoleResponseSchema,
  compartmentRolesPathname,
  type AccessRoleResponse,
  type AccessRoleSummary,
  type PermissionKey,
} from '@compartment/contracts/browser';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import { requestBrowserApi } from '../../lib/browser-api';
import { normalizeBrowserActionErrorMessage, type BrowserActionFieldLabelMap } from '../../lib/browser-action-error';
import { normalizeOptionalDescription } from '../access/access-description.helpers';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { invalidateRoleAccessQueries } from './roles-query-state';

export type RolePageSetter = (
  value: BrowserRolesPageResult | ((current: BrowserRolesPageResult) => BrowserRolesPageResult),
) => void;
type RoleDrawerErrorSetter = (value: string | undefined) => void;

const roleEditorFieldLabels: BrowserActionFieldLabelMap = {
  name: 'role name',
  permissionKeys: 'permission',
};

export async function handleRoleSubmit(
  data: BrowserRolesPageResult,
  editingRole: AccessRoleSummary | null,
  description: string,
  name: string,
  permissionKeys: PermissionKey[],
  setData: RolePageSetter,
  setErrorMessage?: RoleDrawerErrorSetter,
): Promise<boolean> {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(data.selectedOrganizationSlug);

  return await runRoleAction(data, setData, setErrorMessage, async (): Promise<void> => {
    await submitRoleChange(organizationSlug, editingRole, description, name, permissionKeys);
  });
}

export async function handleRoleDelete(
  role: AccessRoleSummary,
  data: BrowserRolesPageResult,
  setData: RolePageSetter,
  setErrorMessage?: RoleDrawerErrorSetter,
): Promise<boolean> {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(data.selectedOrganizationSlug);

  return await runRoleAction(data, setData, setErrorMessage, async (): Promise<void> => {
    await requestBrowserApi(`${compartmentRolesPathname}/${role.id}`, accessRoleResponseSchema, {
      currentOrganization: organizationSlug,
      method: 'DELETE',
    });
  });
}

export function readRoleDeleteConfirmationMessage(roleName: string): string {
  return `Type ${roleName} to remove this role.`;
}

async function runRoleAction(
  data: BrowserRolesPageResult,
  setData: RolePageSetter,
  setErrorMessage: RoleDrawerErrorSetter | undefined,
  action: () => Promise<void>,
): Promise<boolean> {
  setErrorMessage?.(undefined);
  try {
    await action();
    await invalidateRoleAccessQueries(data);
    return true;
  } catch (error) {
    handleRoleActionError(setData, setErrorMessage, error instanceof Error ? error : undefined);
    return false;
  }
}

async function submitRoleChange(
  organizationSlug: string,
  editingRole: AccessRoleSummary | null,
  description: string,
  name: string,
  permissionKeys: PermissionKey[],
): Promise<AccessRoleResponse> {
  return await requestBrowserApi(
    editingRole === null ? compartmentRolesPathname : `${compartmentRolesPathname}/${editingRole.id}`,
    accessRoleResponseSchema,
    {
      currentOrganization: organizationSlug,
      json: { description: normalizeOptionalDescription(description), name, permissionKeys },
      method: editingRole === null ? 'POST' : 'PATCH',
    },
  );
}

function handleRoleActionError(
  setData: RolePageSetter,
  setErrorMessage: RoleDrawerErrorSetter | undefined,
  error: Error | undefined,
): void {
  const errorMessage: string = normalizeBrowserActionErrorMessage(error, 'Role action failed.', roleEditorFieldLabels);
  if (setErrorMessage !== undefined) {
    setErrorMessage(errorMessage);
    return;
  }
  setData((current: BrowserRolesPageResult): BrowserRolesPageResult => ({ ...current, errorMessage }));
}
