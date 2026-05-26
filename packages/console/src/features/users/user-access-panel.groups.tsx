import type { AccessGroupListRow, AccessGroupSummary, UserAccessDetail } from '@compartment/contracts/browser';
import { type ChangeEvent, type FormEvent, type JSX } from 'react';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { Select } from '../../components/select';
import { Button } from '../../components/ui/button';
import { Plus } from '../../components/ui/icons';
import { formatGroupScopeSummary } from '../access/access-display';
import { AccessDrawerList, AccessDrawerListEmpty, AccessDrawerListRow } from '../access/access-drawer-list';
import {
  accessDrawerPrimaryActionButtonClassName,
  accessDrawerRowActionButtonClassName,
  AccessDrawerSection,
} from '../access/access-ui';
import { type UserAccessPanelSetter } from './user-access-panel.actions';
import {
  type UserGroupMutation,
  useUserGroupAddMutation,
  useUserGroupRemoveMutation,
} from './user-access-panel.group-mutations';

interface UserGroupMembershipsCardProps {
  access: UserAccessDetail;
  availableGroups: AccessGroupSummary[];
  canManageGroups: boolean;
  data: BrowserUsersPageResult;
  groupId: string;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
  setGroupId: (value: string) => void;
}

interface UserGroupAddFormProps {
  access: UserAccessDetail;
  availableGroups: AccessGroupSummary[];
  data: BrowserUsersPageResult;
  groupId: string;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
  setGroupId: (value: string) => void;
}

interface UserGroupMembershipRowProps {
  canManageGroups: boolean;
  data: BrowserUsersPageResult;
  email: string;
  group: AccessGroupSummary;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}

export function UserGroupMembershipsCard(props: Readonly<UserGroupMembershipsCardProps>): JSX.Element {
  return (
    <AccessDrawerSection title="Groups">
      <div className="space-y-4">
        {readUserGroupAddForm(props)}
        <UserGroupMembershipRows
          access={props.access}
          canManageGroups={props.canManageGroups}
          data={props.data}
          setData={props.setData}
          setErrorMessage={props.setErrorMessage}
        />
      </div>
    </AccessDrawerSection>
  );
}

function readUserGroupAddForm(props: UserGroupMembershipsCardProps): JSX.Element | null {
  if (!props.canManageGroups) {
    return null;
  }

  return (
    <UserGroupAddForm
      access={props.access}
      availableGroups={props.availableGroups}
      data={props.data}
      groupId={props.groupId}
      setData={props.setData}
      setErrorMessage={props.setErrorMessage}
      setGroupId={props.setGroupId}
    />
  );
}

function UserGroupAddForm(props: Readonly<UserGroupAddFormProps>): JSX.Element {
  const mutation: UserGroupMutation = useUserGroupAddMutation(props);

  return (
    <form
      className="flex flex-col gap-2 md:flex-row md:items-center"
      onSubmit={createUserGroupAddHandler(props, mutation)}
    >
      <UserGroupSelect props={props} />
      <UserGroupAddButton disabled={props.groupId === '' || mutation.isPending} isPending={mutation.isPending} />
    </form>
  );
}

function UserGroupSelect({ props }: Readonly<{ props: UserGroupAddFormProps }>): JSX.Element {
  return (
    <Select
      className="h-9"
      containerClassName="flex-1"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void => props.setGroupId(event.target.value)}
      value={props.groupId}
    >
      <option value="">Select group</option>
      {props.availableGroups.map(renderUserGroupOption)}
    </Select>
  );
}

function renderUserGroupOption(group: AccessGroupSummary): JSX.Element {
  return (
    <option key={group.id} value={group.id}>
      {group.name}
    </option>
  );
}

function UserGroupAddButton({ disabled, isPending }: Readonly<{ disabled: boolean; isPending: boolean }>): JSX.Element {
  return (
    <Button className={accessDrawerPrimaryActionButtonClassName} disabled={disabled} type="submit" variant="default">
      {isPending ? null : <Plus className="size-4" />}
      {isPending ? 'Adding...' : 'Add user to group'}
    </Button>
  );
}

function createUserGroupAddHandler(
  props: UserGroupAddFormProps,
  mutation: UserGroupMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (props.groupId === '' || mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function UserGroupMembershipRows({
  access,
  canManageGroups,
  data,
  setData,
  setErrorMessage,
}: Readonly<{
  access: UserAccessDetail;
  canManageGroups: boolean;
  data: BrowserUsersPageResult;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}>): JSX.Element {
  const rows: JSX.Element[] = renderGroupMembershipRows(
    access.groups,
    canManageGroups,
    data,
    access.user.email,
    setData,
    setErrorMessage,
  );

  return <AccessDrawerList>{rows}</AccessDrawerList>;
}

function renderGroupMembershipRows(
  groups: AccessGroupSummary[],
  canManageGroups: boolean,
  data: BrowserUsersPageResult,
  email: string,
  setData: UserAccessPanelSetter,
  setErrorMessage: (value: string | undefined) => void,
): JSX.Element[] {
  if (groups.length === 0) {
    return [<AccessDrawerListEmpty key="empty" message="No group memberships." />];
  }

  return groups.map(
    (group: AccessGroupSummary): JSX.Element => (
      <UserGroupMembershipRow
        canManageGroups={canManageGroups}
        data={data}
        email={email}
        group={group}
        key={group.id}
        setData={setData}
        setErrorMessage={setErrorMessage}
      />
    ),
  );
}

function UserGroupMembershipRow(props: Readonly<UserGroupMembershipRowProps>): JSX.Element {
  const groupDetails: AccessGroupListRow | undefined = props.data.availableGroups.find(
    (group: AccessGroupListRow): boolean => group.id === props.group.id,
  );

  return (
    <AccessDrawerListRow className="md:grid-cols-[144px_116px_minmax(0,1fr)_auto]">
      <div className="text-[13px] font-semibold leading-[18px]">{props.group.name}</div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {readAssignmentCountLabel(props.group.assignmentCount)}
      </div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {readGroupScopeLabel(groupDetails)}
      </div>
      {props.canManageGroups ? <UserGroupRemoveButton props={props} /> : null}
    </AccessDrawerListRow>
  );
}

function readAssignmentCountLabel(count: number): string {
  return count === 1 ? '1 assignment' : `${count} assignments`;
}

function readGroupScopeLabel(group: AccessGroupListRow | undefined): string {
  return group === undefined ? 'No scopes' : formatGroupScopeSummary(group);
}

function UserGroupRemoveButton({ props }: Readonly<{ props: UserGroupMembershipRowProps }>): JSX.Element {
  const mutation: UserGroupMutation = useUserGroupRemoveMutation(props);

  return (
    <Button
      className={accessDrawerRowActionButtonClassName}
      disabled={mutation.isPending}
      onClick={createUserGroupRemoveHandler(mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Removing...' : 'Remove'}
    </Button>
  );
}

function createUserGroupRemoveHandler(mutation: UserGroupMutation): () => void {
  return (): void => {
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}
