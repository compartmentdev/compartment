import type { AccessGroupMemberSummary } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { type FormEvent, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Plus } from '../../components/ui/icons';
import { StatusTag } from '../../components/ui/status-tag';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessDrawerList, AccessDrawerListEmpty, AccessDrawerListRow } from '../access/access-drawer-list';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import {
  accessDrawerPrimaryActionButtonClassName,
  accessDrawerRowActionButtonClassName,
  AccessDrawerSection,
} from '../access/access-ui';
import {
  handleGroupMemberAddAction,
  handleGroupMemberDeleteAction,
  type GroupsPageSetter,
} from './groups-page.actions';
import { GroupMemberAutocompleteField } from './groups-page.member-autocomplete';

interface GroupMembersCardProps {
  canManageGroups: boolean;
  data: BrowserGroupsPageResult;
  groupId: string;
  memberEmail: string;
  members: AccessGroupMemberSummary[];
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
  setMemberEmail: (value: string) => void;
}

interface GroupMemberAddFormProps {
  data: BrowserGroupsPageResult;
  groupId: string;
  memberEmail: string;
  members: AccessGroupMemberSummary[];
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
  setMemberEmail: (value: string) => void;
}

interface GroupMemberRowProps {
  canManageGroups: boolean;
  data: BrowserGroupsPageResult;
  groupId: string;
  member: AccessGroupMemberSummary;
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
}

type GroupMemberStatus = 'active' | 'invited';

type GroupMemberMutation = UseMutationResult<void, Error, void>;

export function GroupMembersCard(props: Readonly<GroupMembersCardProps>): JSX.Element {
  return (
    <AccessDrawerSection title="Group members">
      <div className="space-y-3">
        {readGroupMemberAddForm(props)}
        <GroupMemberRows
          canManageGroups={props.canManageGroups}
          data={props.data}
          groupId={props.groupId}
          members={props.members}
          setData={props.setData}
          setErrorMessage={props.setErrorMessage}
        />
      </div>
    </AccessDrawerSection>
  );
}

function readGroupMemberAddForm(props: GroupMembersCardProps): JSX.Element | null {
  if (!props.canManageGroups) {
    return null;
  }

  return (
    <GroupMemberAddForm
      data={props.data}
      groupId={props.groupId}
      memberEmail={props.memberEmail}
      members={props.members}
      setData={props.setData}
      setErrorMessage={props.setErrorMessage}
      setMemberEmail={props.setMemberEmail}
    />
  );
}

function GroupMemberAddForm(props: Readonly<GroupMemberAddFormProps>): JSX.Element {
  const mutation: GroupMemberMutation = useGroupMemberAddMutation(props);

  return (
    <form
      className="flex flex-col gap-2 md:flex-row md:items-center"
      onSubmit={createGroupMemberAddHandler(props, mutation)}
    >
      <GroupMemberAutocompleteField
        memberEmail={props.memberEmail}
        members={props.members}
        organizationSlug={props.data.selectedOrganizationSlug}
        setMemberEmail={props.setMemberEmail}
      />
      <Button
        className={accessDrawerPrimaryActionButtonClassName}
        disabled={mutation.isPending}
        type="submit"
        variant="default"
      >
        {mutation.isPending ? null : <Plus className="size-4" />}
        {mutation.isPending ? 'Adding...' : 'Add member'}
      </Button>
    </form>
  );
}

function useGroupMemberAddMutation(props: GroupMemberAddFormProps): GroupMemberMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleGroupMemberAddAction(
        props.data,
        props.groupId,
        props.memberEmail,
        props.setData,
        props.setErrorMessage,
        props.setMemberEmail,
      ),
    mutationKey: ['console-access', 'groups', organizationSlug, props.groupId, 'members', 'add'],
  });
}

function createGroupMemberAddHandler(
  props: GroupMemberAddFormProps,
  mutation: GroupMemberMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function GroupMemberRows({
  canManageGroups,
  data,
  groupId,
  members,
  setData,
  setErrorMessage,
}: Readonly<{
  canManageGroups: boolean;
  data: BrowserGroupsPageResult;
  groupId: string;
  members: AccessGroupMemberSummary[];
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
}>): JSX.Element {
  return (
    <AccessDrawerList>
      {renderGroupMemberRows(members, canManageGroups, data, groupId, setData, setErrorMessage)}
    </AccessDrawerList>
  );
}

function renderGroupMemberRows(
  members: AccessGroupMemberSummary[],
  canManageGroups: boolean,
  data: BrowserGroupsPageResult,
  groupId: string,
  setData: GroupsPageSetter,
  setErrorMessage: (value: string | undefined) => void,
): JSX.Element[] {
  if (members.length === 0) {
    return [<AccessDrawerListEmpty key="empty" message="No members." />];
  }

  return members.map(
    (member: AccessGroupMemberSummary): JSX.Element => (
      <GroupMemberRow
        canManageGroups={canManageGroups}
        data={data}
        groupId={groupId}
        key={member.id}
        member={member}
        setData={setData}
        setErrorMessage={setErrorMessage}
      />
    ),
  );
}

function GroupMemberRow(props: Readonly<GroupMemberRowProps>): JSX.Element {
  return (
    <AccessDrawerListRow className="md:grid-cols-[minmax(0,1fr)_120px_auto]">
      <div className="text-[13px] font-semibold leading-[18px]">{props.member.email}</div>
      <div>{renderGroupMemberStatus(props.member.status)}</div>
      {props.canManageGroups ? <GroupMemberRemoveButton props={props} /> : null}
    </AccessDrawerListRow>
  );
}

function renderGroupMemberStatus(status: GroupMemberStatus): JSX.Element {
  return (
    <StatusTag
      icon={status === 'active' ? 'active' : 'invited'}
      label={readGroupMemberStatusLabel(status)}
      variant={status === 'active' ? 'success' : 'secondary'}
    />
  );
}

function readGroupMemberStatusLabel(status: GroupMemberStatus): string {
  return status === 'active' ? 'Active' : 'Invited';
}

function GroupMemberRemoveButton({ props }: Readonly<{ props: GroupMemberRowProps }>): JSX.Element {
  const mutation: GroupMemberMutation = useGroupMemberRemoveMutation(props);

  return (
    <Button
      className={accessDrawerRowActionButtonClassName}
      disabled={mutation.isPending}
      onClick={createGroupMemberRemoveHandler(mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Removing...' : 'Remove'}
    </Button>
  );
}

function useGroupMemberRemoveMutation(props: GroupMemberRowProps): GroupMemberMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(props.data.selectedOrganizationSlug);
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> =>
      await handleGroupMemberDeleteAction(
        props.data,
        props.groupId,
        props.member.email,
        props.setData,
        props.setErrorMessage,
      ),
    mutationKey: ['console-access', 'groups', organizationSlug, props.groupId, 'members', props.member.email, 'remove'],
  });
}

function createGroupMemberRemoveHandler(mutation: GroupMemberMutation): () => void {
  return (): void => {
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}
