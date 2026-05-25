import { useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';
import type { PermissionKey } from '@compartment/contracts/browser';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { RolePageSetter } from './roles-page.actions';

export interface RolesPageState {
  data: BrowserRolesPageResult;
  description: string;
  drawerErrorMessage: string | undefined;
  name: string;
  onNavigate: BrowserSoftNavigateHandler;
  selectedPermissions: PermissionKey[];
  setData: RolePageSetter;
  setDescription: (value: string) => void;
  setDrawerErrorMessage: (value: string | undefined) => void;
  setName: (value: string) => void;
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void;
}

interface RolesPageData {
  data: BrowserRolesPageResult;
  setData: RolePageSetter;
}

interface RolesPageEditorState {
  description: string;
  drawerErrorMessage: string | undefined;
  name: string;
  selectedPermissions: PermissionKey[];
  setDescription: (value: string) => void;
  setDrawerErrorMessage: (value: string | undefined) => void;
  setName: (value: string) => void;
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void;
}

class RolesPageStateValue implements RolesPageState {
  public data!: BrowserRolesPageResult;
  public description!: string;
  public drawerErrorMessage!: string | undefined;
  public name!: string;
  public onNavigate!: BrowserSoftNavigateHandler;
  public selectedPermissions!: PermissionKey[];
  public setData!: RolePageSetter;
  public setDescription!: (value: string) => void;
  public setDrawerErrorMessage!: (value: string | undefined) => void;
  public setName!: (value: string) => void;
  public setSelectedPermissions!: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void;
}

export function useRolesPageState(loaderData: BrowserRolesPageResult, navigate: NavigateFunction): RolesPageState {
  const pageData: RolesPageData = useRolesPageData(loaderData);
  const editorState: RolesPageEditorState = useRolesPageEditorState(loaderData);
  const onNavigate: BrowserSoftNavigateHandler = (href: string): void => void navigate(href);

  return Object.assign(new RolesPageStateValue(), { onNavigate, ...pageData, ...editorState });
}

function useRolesPageData(loaderData: BrowserRolesPageResult): RolesPageData {
  const [data, setData] = useState<BrowserRolesPageResult>(loaderData);

  useEffect((): void => {
    setData(loaderData);
  }, [loaderData]);

  return { data, setData };
}

function useRolesPageEditorState(loaderData: BrowserRolesPageResult): RolesPageEditorState {
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | undefined>(undefined);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKey[]>([]);

  useEffect((): void => {
    syncRoleEditor(loaderData, setDescription, setName, setSelectedPermissions);
  }, [loaderData]);
  useEffect((): void => {
    setDrawerErrorMessage(undefined);
  }, [loaderData.mode, loaderData.roleId, loaderData.selectedOrganizationSlug]);

  return {
    description,
    drawerErrorMessage,
    name,
    selectedPermissions,
    setDescription,
    setDrawerErrorMessage,
    setName,
    setSelectedPermissions,
  };
}

function syncRoleEditor(
  loaderData: BrowserRolesPageResult,
  setDescription: (value: string) => void,
  setName: (value: string) => void,
  setSelectedPermissions: (value: PermissionKey[]) => void,
): void {
  if (loaderData.mode === 'create') {
    setName('');
    setDescription('');
    setSelectedPermissions([]);
    return;
  }

  setName(loaderData.role?.name ?? '');
  setDescription(loaderData.role?.description ?? '');
  setSelectedPermissions(loaderData.role?.permissionKeys ?? []);
}
