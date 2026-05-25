import {
  type AccessAssignmentScopeType,
  type AccessAssignmentSummary,
  type AccessGroupListRow,
  type AccessRoleListRow,
} from '@compartment/contracts/browser';
import { type SetStateAction, useEffect, useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { readNextAccessOptionId } from '../access/access-option';
import { syncAccessScopeSelections } from '../access/access-scope-selection';
import type { GroupsPageSetter } from './groups-page.actions';
import { GroupsPageStateValue } from './groups-page.state.value';

export interface GroupsPageState {
  data: BrowserGroupsPageResult;
  drawerErrorMessage: string | undefined;
  environmentValues: string[];
  groupAssignments: AccessAssignmentSummary[];
  groupDescription: string;
  groupName: string;
  memberEmail: string;
  newGroupDescription: string;
  newGroupName: string;
  onNavigate: BrowserSoftNavigateHandler;
  projectNames: string[];
  roleId: string;
  scopeType: AccessAssignmentScopeType;
  selectedGroup: AccessGroupListRow | undefined;
  setData: GroupsPageSetter;
  setDrawerErrorMessage: (value: string | undefined) => void;
  setEnvironmentValues: (value: string[]) => void;
  setGroupDescription: (value: string) => void;
  setGroupName: (value: string) => void;
  setMemberEmail: (value: string) => void;
  setNewGroupDescription: (value: string) => void;
  setNewGroupName: (value: string) => void;
  setProjectNames: (value: string[]) => void;
  setRoleId: (value: SetStateAction<string>) => void;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

interface GroupIdentityFields {
  drawerErrorMessage: string | undefined;
  groupDescription: string;
  groupName: string;
  memberEmail: string;
  newGroupDescription: string;
  newGroupName: string;
  setDrawerErrorMessage: (value: string | undefined) => void;
  setGroupDescription: (value: string) => void;
  setGroupName: (value: string) => void;
  setMemberEmail: (value: string) => void;
  setNewGroupDescription: (value: string) => void;
  setNewGroupName: (value: string) => void;
}

interface GroupAssignmentFields {
  environmentValues: string[];
  projectNames: string[];
  roleId: string;
  scopeType: AccessAssignmentScopeType;
  setEnvironmentValues: (value: string[]) => void;
  setProjectNames: (value: string[]) => void;
  setRoleId: (value: SetStateAction<string>) => void;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

type GroupsPageFormState = Pick<
  GroupsPageState,
  | 'drawerErrorMessage'
  | 'environmentValues'
  | 'groupDescription'
  | 'groupName'
  | 'memberEmail'
  | 'newGroupDescription'
  | 'newGroupName'
  | 'projectNames'
  | 'roleId'
  | 'scopeType'
  | 'setDrawerErrorMessage'
  | 'setEnvironmentValues'
  | 'setGroupDescription'
  | 'setGroupName'
  | 'setMemberEmail'
  | 'setNewGroupDescription'
  | 'setNewGroupName'
  | 'setProjectNames'
  | 'setRoleId'
  | 'setScopeType'
>;

type GroupsPageSelectionState = Pick<GroupsPageState, 'groupAssignments' | 'selectedGroup'>;

export function useGroupsPageState(loaderData: BrowserGroupsPageResult, navigate: NavigateFunction): GroupsPageState {
  const [data, setData] = useState<BrowserGroupsPageResult>(loaderData);
  const formState: GroupsPageFormState = useGroupsPageFormState(data);
  const selectionState: GroupsPageSelectionState = useGroupsPageSelectionState(data);
  const onNavigate: BrowserSoftNavigateHandler = (href: string): void => void navigate(href);
  useEffect((): void => setData(loaderData), [loaderData]);
  return Object.assign(new GroupsPageStateValue(), { data, onNavigate, setData, ...formState, ...selectionState });
}

function useGroupsPageFormState(data: BrowserGroupsPageResult): GroupsPageFormState {
  const formFields: GroupsPageFormState = useGroupsPageFormFields();
  useGroupsPageFormEffects(data, formFields);
  return formFields;
}

function useGroupsPageSelectionState(data: BrowserGroupsPageResult): GroupsPageSelectionState {
  const selectedGroup: AccessGroupListRow | undefined = useMemo(
    (): AccessGroupListRow | undefined => readSelectedGroup(data.groups, data.selectedGroupId),
    [data.groups, data.selectedGroupId],
  );
  const groupAssignments: AccessAssignmentSummary[] = useMemo(
    (): AccessAssignmentSummary[] => readGroupAssignments(data.assignments, data.selectedGroupId),
    [data.assignments, data.selectedGroupId],
  );
  return { groupAssignments, selectedGroup };
}

function useGroupsPageFormFields(): GroupsPageFormState {
  const identityFields: GroupIdentityFields = useGroupIdentityFields();
  const assignmentFields: GroupAssignmentFields = useGroupAssignmentFields();
  return { ...identityFields, ...assignmentFields };
}

function readSelectedGroup(
  groups: AccessGroupListRow[],
  selectedGroupId: string | null,
): AccessGroupListRow | undefined {
  return groups.find((group: AccessGroupListRow): boolean => group.id === selectedGroupId);
}

function readGroupAssignments(
  assignments: AccessAssignmentSummary[],
  selectedGroupId: string | null,
): AccessAssignmentSummary[] {
  return assignments.filter(
    (assignment: AccessAssignmentSummary): boolean =>
      assignment.subject.subjectType === 'group' && assignment.subject.groupId === selectedGroupId,
  );
}

function useGroupIdentityFields(): GroupIdentityFields {
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | undefined>(undefined);
  const [groupName, setGroupName] = useState<string>('');
  const [groupDescription, setGroupDescription] = useState<string>('');
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [newGroupDescription, setNewGroupDescription] = useState<string>('');
  const [memberEmail, setMemberEmail] = useState<string>('');

  return {
    drawerErrorMessage,
    groupDescription,
    groupName,
    memberEmail,
    newGroupDescription,
    newGroupName,
    setDrawerErrorMessage,
    setGroupDescription,
    setGroupName,
    setMemberEmail,
    setNewGroupDescription,
    setNewGroupName,
  };
}

function useGroupAssignmentFields(): GroupAssignmentFields {
  const [roleId, setRoleId] = useState<string>('');
  const [scopeType, setScopeType] = useState<AccessAssignmentScopeType>('organization');
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [environmentValues, setEnvironmentValues] = useState<string[]>([]);

  return {
    environmentValues,
    projectNames,
    roleId,
    scopeType,
    setEnvironmentValues,
    setProjectNames,
    setRoleId,
    setScopeType,
  };
}

function useGroupsPageFormEffects(data: BrowserGroupsPageResult, formFields: GroupsPageFormState): void {
  useEffect((): void => syncRoleId(data.roles, formFields.setRoleId), [data.roles, formFields.setRoleId]);
  useEffect(
    (): void =>
      syncAccessScopeSelections({
        environmentValues: formFields.environmentValues,
        projectNames: formFields.projectNames,
        scopeProjects: data.scopeProjects,
        setEnvironmentValues: formFields.setEnvironmentValues,
        setProjectNames: formFields.setProjectNames,
      }),
    [
      data.scopeProjects,
      formFields.environmentValues,
      formFields.projectNames,
      formFields.setEnvironmentValues,
      formFields.setProjectNames,
    ],
  );
  useResetGroupsDrawerError(data, formFields.setDrawerErrorMessage);
}

function syncRoleId(roles: AccessRoleListRow[], setRoleId: (value: SetStateAction<string>) => void): void {
  setRoleId((current: string): string => readNextAccessOptionId(roles, current));
}

function useResetGroupsDrawerError(
  data: BrowserGroupsPageResult,
  setDrawerErrorMessage: (value: string | undefined) => void,
): void {
  useEffect((): void => {
    setDrawerErrorMessage(undefined);
  }, [data.mode, data.selectedGroupId, data.selectedOrganizationSlug, setDrawerErrorMessage]);
}
