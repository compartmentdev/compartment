import {
  type AccessAssignmentScopeType,
  type AccessGroupListRow,
  type AccessGroupSummary,
  type AccessRoleListRow,
  type UserAccessDetail,
} from '@compartment/contracts/browser';
import { type MutableRefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { readNextAccessOptionId } from '../access/access-option';
import { syncAccessScopeSelections } from '../access/access-scope-selection';
import type { UserAccessPanelSetter } from './user-access-panel.actions';
import { type VisibleUserInvitationState, shouldKeepUserInvitationState } from './user-invitation';

export interface UserAccessPanelState {
  availableGroups: AccessGroupListRow[];
  data: BrowserUsersPageResult;
  drawerErrorMessage: string | undefined;
  environmentValues: string[];
  groupId: string;
  inviteEmail: string;
  onNavigate: BrowserSoftNavigateHandler;
  projectNames: string[];
  roleId: string;
  scopeType: AccessAssignmentScopeType;
  selectedAccess: UserAccessDetail | null;
  setData: UserAccessPanelSetter;
  setDrawerErrorMessage: (value: string | undefined) => void;
  setEnvironmentValues: (value: string[]) => void;
  setGroupId: (value: SetStateAction<string>) => void;
  setInviteEmail: (value: string) => void;
  setProjectNames: (value: string[]) => void;
  setRoleId: (value: SetStateAction<string>) => void;
  setScopeType: (value: AccessAssignmentScopeType) => void;
  setUserInvitationState: (value: VisibleUserInvitationState | null) => void;
  userInvitationState: VisibleUserInvitationState | null;
}

type UserAccessEditorFields = Pick<
  UserAccessPanelState,
  | 'drawerErrorMessage'
  | 'environmentValues'
  | 'groupId'
  | 'inviteEmail'
  | 'projectNames'
  | 'roleId'
  | 'scopeType'
  | 'setDrawerErrorMessage'
  | 'setEnvironmentValues'
  | 'setGroupId'
  | 'setInviteEmail'
  | 'setProjectNames'
  | 'setRoleId'
  | 'setScopeType'
  | 'setUserInvitationState'
  | 'userInvitationState'
>;

type UserAccessPanelEditorState = Pick<UserAccessPanelState, 'availableGroups' | 'selectedAccess'> &
  UserAccessEditorFields;
type UserAccessPanelMode = 'create' | 'detail' | 'list';

export function useUserAccessPanelState(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  setData: UserAccessPanelSetter,
): UserAccessPanelState {
  const editorState: UserAccessPanelEditorState = useUserAccessPanelEditorState(data);
  return { data, onNavigate, setData, ...editorState };
}

function useUserAccessPanelEditorState(data: BrowserUsersPageResult): UserAccessPanelEditorState {
  const selectedAccess: UserAccessDetail | null = data.selectedUserAccess;
  const editorFields: UserAccessEditorFields = useUserAccessEditorFields();
  const availableGroups: AccessGroupListRow[] = useAvailableGroups(data.availableGroups, selectedAccess);

  useUserAccessEditorEffects(data, editorFields, availableGroups);
  return {
    availableGroups,
    selectedAccess,
    ...editorFields,
  };
}

function useAvailableGroups(
  groups: AccessGroupListRow[],
  selectedAccess: UserAccessDetail | null,
): AccessGroupListRow[] {
  return useMemo((): AccessGroupListRow[] => readAvailableGroups(groups, selectedAccess), [groups, selectedAccess]);
}

function readAvailableGroups(
  groups: AccessGroupListRow[],
  selectedAccess: UserAccessDetail | null,
): AccessGroupListRow[] {
  return groups.filter(
    (group: AccessGroupListRow): boolean =>
      !(
        selectedAccess?.groups.some((memberGroup: AccessGroupSummary): boolean => memberGroup.id === group.id) ?? false
      ),
  );
}

function useUserAccessEditorFields(): UserAccessEditorFields {
  const stateFields: Omit<UserAccessEditorFields, 'setUserInvitationState' | 'userInvitationState'> =
    useUserAccessStateFields();
  const invitationFields: Pick<UserAccessEditorFields, 'setUserInvitationState' | 'userInvitationState'> =
    useUserInvitationFields();
  return { ...stateFields, ...invitationFields };
}

function useUserAccessStateFields(): Omit<UserAccessEditorFields, 'setUserInvitationState' | 'userInvitationState'> {
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | undefined>(undefined);
  const [groupId, setGroupId] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [roleId, setRoleId] = useState<string>('');
  const [scopeType, setScopeType] = useState<AccessAssignmentScopeType>('organization');
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [environmentValues, setEnvironmentValues] = useState<string[]>([]);

  return {
    drawerErrorMessage,
    environmentValues,
    groupId,
    inviteEmail,
    projectNames,
    roleId,
    scopeType,
    setDrawerErrorMessage,
    setEnvironmentValues,
    setGroupId,
    setInviteEmail,
    setProjectNames,
    setRoleId,
    setScopeType,
  };
}

function useUserInvitationFields(): Pick<UserAccessEditorFields, 'setUserInvitationState' | 'userInvitationState'> {
  const [userInvitationState, setUserInvitationState] = useState<VisibleUserInvitationState | null>(null);
  return { setUserInvitationState, userInvitationState };
}

function useUserAccessEditorEffects(
  data: BrowserUsersPageResult,
  editorFields: UserAccessEditorFields,
  availableGroups: AccessGroupListRow[],
): void {
  useSyncUserAccessOptionIds(data, editorFields, availableGroups);
  useSyncUserAccessScopeState(data, editorFields);
  useSyncUserInvitationState(data, editorFields);
  useEffect((): void => {
    editorFields.setDrawerErrorMessage(undefined);
  }, [data.mode, data.selectedOrganizationSlug, data.selectedUserEmail, editorFields.setDrawerErrorMessage]);
}

function useSyncUserAccessOptionIds(
  data: BrowserUsersPageResult,
  editorFields: UserAccessEditorFields,
  availableGroups: AccessGroupListRow[],
): void {
  useEffect((): void => syncFirstGroupId(availableGroups, editorFields.setGroupId), [availableGroups, editorFields]);
  useEffect(
    (): void => syncFirstRoleId(data.availableRoles, editorFields.setRoleId),
    [data.availableRoles, editorFields],
  );
}

function useSyncUserAccessScopeState(data: BrowserUsersPageResult, editorFields: UserAccessEditorFields): void {
  useEffect(
    (): void =>
      syncAccessScopeSelections({
        environmentValues: editorFields.environmentValues,
        projectNames: editorFields.projectNames,
        scopeProjects: data.scopeProjects,
        setEnvironmentValues: editorFields.setEnvironmentValues,
        setProjectNames: editorFields.setProjectNames,
      }),
    [data.scopeProjects, editorFields],
  );
}

function useSyncUserInvitationState(data: BrowserUsersPageResult, editorFields: UserAccessEditorFields): void {
  const previousModeRef: MutableRefObject<UserAccessPanelMode> = useRef<UserAccessPanelMode>(data.mode);

  useEffect((): void => {
    if (!shouldKeepUserInvitationState(editorFields.userInvitationState, data.selectedOrganizationSlug)) {
      editorFields.setUserInvitationState(null);
    }
  }, [data.selectedOrganizationSlug, editorFields]);
  useEffect((): void => {
    if (previousModeRef.current !== 'create' && data.mode === 'create') {
      editorFields.setInviteEmail('');
      editorFields.setUserInvitationState(null);
    }
    previousModeRef.current = data.mode;
  }, [data.mode, editorFields]);
}

function syncFirstGroupId(
  groups: AccessGroupListRow[],
  setGroupId: (value: string | ((current: string) => string)) => void,
): void {
  setGroupId((current: string): string => readNextAccessOptionId(groups, current));
}

function syncFirstRoleId(
  roles: AccessRoleListRow[],
  setRoleId: (value: string | ((current: string) => string)) => void,
): void {
  setRoleId((current: string): string => readNextAccessOptionId(roles, current));
}
