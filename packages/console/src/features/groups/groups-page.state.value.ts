import type {
  AccessAssignmentScopeType,
  AccessAssignmentSummary,
  AccessGroupListRow,
} from '@compartment/contracts/browser';
import type { SetStateAction } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import type { GroupsPageSetter } from './groups-page.actions';
import type { GroupsPageState } from './groups-page.state';

export class GroupsPageStateValue implements GroupsPageState {
  public data!: BrowserGroupsPageResult;
  public drawerErrorMessage!: string | undefined;
  public environmentValues!: string[];
  public groupAssignments!: AccessAssignmentSummary[];
  public groupDescription!: string;
  public groupName!: string;
  public memberEmail!: string;
  public newGroupDescription!: string;
  public newGroupName!: string;
  public onNavigate!: BrowserSoftNavigateHandler;
  public projectNames!: string[];
  public roleId!: string;
  public scopeType!: AccessAssignmentScopeType;
  public selectedGroup!: AccessGroupListRow | undefined;
  public setData!: GroupsPageSetter;
  public setDrawerErrorMessage!: (value: string | undefined) => void;
  public setEnvironmentValues!: (value: string[]) => void;
  public setGroupDescription!: (value: string) => void;
  public setGroupName!: (value: string) => void;
  public setMemberEmail!: (value: string) => void;
  public setNewGroupDescription!: (value: string) => void;
  public setNewGroupName!: (value: string) => void;
  public setProjectNames!: (value: string[]) => void;
  public setRoleId!: (value: SetStateAction<string>) => void;
  public setScopeType!: (value: AccessAssignmentScopeType) => void;
}
