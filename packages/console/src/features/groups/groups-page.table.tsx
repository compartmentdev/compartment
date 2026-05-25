import type { AccessGroupListRow } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import {
  ServerTable,
  ServerTableActions,
  ServerTableCell,
  ServerTableEmptyRow,
  ServerTableHeading,
  ServerTableRow,
  readServerTableActionControlClassName,
} from '../../components/server-table';
import { Button } from '../../components/ui/button';
import { formatGroupAccessSummary, formatGroupScopeSummary } from '../access/access-display';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface GroupsTableProps {
  groups: AccessGroupListRow[];
  state: GroupsPageState;
}

interface GroupRowProps {
  group: AccessGroupListRow;
  state: GroupsPageState;
}

export function GroupsTable({ groups, state }: Readonly<GroupsTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[1040px]">
      <thead className="bg-background">
        <tr>
          <ServerTableHeading label="Group" />
          <ServerTableHeading label="Members" />
          <ServerTableHeading label="Access" />
          <ServerTableHeading label="Scope" />
          <ServerTableHeading label="Description" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderGroupRows(groups, state)}</tbody>
    </ServerTable>
  );
}

export function readGroupSearchText(group: AccessGroupListRow): string {
  return [group.name, group.description ?? '', ...group.assignedRoleNames, ...group.assignmentScopeLabels]
    .join(' ')
    .toLowerCase();
}

function renderGroupRows(groups: AccessGroupListRow[], state: GroupsPageState): JSX.Element[] {
  if (groups.length === 0) {
    return [<ServerTableEmptyRow colSpan={6} key="empty" message="No groups found." />];
  }

  return groups.map(
    (group: AccessGroupListRow): JSX.Element => <GroupRow group={group} key={group.id} state={state} />,
  );
}

function GroupRow({ group, state }: Readonly<GroupRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      <ServerTableCell className="font-medium">{group.name}</ServerTableCell>
      <ServerTableCell>{group.memberCount}</ServerTableCell>
      <ServerTableCell>{formatGroupAccessSummary(group)}</ServerTableCell>
      <ServerTableCell>{formatGroupScopeSummary(group)}</ServerTableCell>
      <ServerTableCell className="max-w-[260px] text-muted-foreground">{readGroupDescription(group)}</ServerTableCell>
      <ServerTableCell align="right">
        <GroupRowActions group={group} state={state} />
      </ServerTableCell>
    </ServerTableRow>
  );
}

function GroupRowActions({ group, state }: Readonly<GroupRowProps>): JSX.Element {
  return (
    <ServerTableActions>
      <Button
        className={readServerTableActionControlClassName()}
        onClick={(): void => {
          state.onNavigate(buildGroupsPageHref(state.data, group.id));
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        Manage
      </Button>
    </ServerTableActions>
  );
}

function readGroupDescription(group: AccessGroupListRow): string {
  return group.description === null || group.description === '' ? 'No description' : group.description;
}
