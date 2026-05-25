import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import {
  ServerTable,
  ServerTableEmptyRow,
  ServerTableHeading,
  ServerTableSortableHeading,
} from '../../components/server-table';
import type {
  BrowserUsersPageResult,
  BrowserUsersSortBy,
  BrowserUsersUser,
} from '../../services/browser-users.service.types';
import type { UserActionHandler } from './user-actions';
import { buildUsersHref, readNextUsersSortDirection } from './users-query';
import { UserRow } from './users-table.row';

interface UsersTableProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onUserAction: UserActionHandler;
}

interface UsersSortableHeadingProps {
  data: BrowserUsersPageResult;
  label: string;
  onNavigate: BrowserSoftNavigateHandler;
  sortBy: BrowserUsersSortBy;
}

export function UsersTable({ data, onNavigate, onUserAction }: Readonly<UsersTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[760px]">
      <thead className="bg-background">
        <tr>
          <UsersSortableHeading data={data} label="User" onNavigate={onNavigate} sortBy="email" />
          <UsersSortableHeading data={data} label="Status" onNavigate={onNavigate} sortBy="status" />
          <ServerTableHeading label="Groups" />
          <ServerTableHeading label="Access" />
          <ServerTableHeading label="Direct access" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderTableRows(data, onNavigate, onUserAction)}</tbody>
    </ServerTable>
  );
}

function renderTableRows(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onUserAction: UserActionHandler,
): JSX.Element[] {
  if (data.users.length === 0 || data.selectedOrganizationSlug === null) {
    return [<ServerTableEmptyRow colSpan={6} key="empty" message="No users found." />];
  }

  const organizationSlug: string = data.selectedOrganizationSlug;

  return data.users.map(
    (user: BrowserUsersUser): JSX.Element => (
      <UserRow
        data={data}
        key={user.id}
        onNavigate={onNavigate}
        onUserAction={onUserAction}
        organizationSlug={organizationSlug}
        user={user}
      />
    ),
  );
}

function UsersSortableHeading({ data, label, onNavigate, sortBy }: Readonly<UsersSortableHeadingProps>): JSX.Element {
  return (
    <ServerTableSortableHeading
      href={buildUsersHref(data, {
        page: 1,
        sortBy,
        sortDirection: readNextUsersSortDirection(data, sortBy),
      })}
      label={label}
      onNavigate={onNavigate}
      sortDirection={data.sortBy === sortBy ? data.sortDirection : undefined}
    />
  );
}
