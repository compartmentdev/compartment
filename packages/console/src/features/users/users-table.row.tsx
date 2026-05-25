import type { JSX } from 'react';
import type {
  BrowserUsersAccountStatus,
  BrowserUsersAccessState,
  BrowserUsersPageResult,
  BrowserUsersUser,
  BrowserUsersUserType,
} from '../../services/browser-users.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { ServerTableCell, ServerTableRow } from '../../components/server-table';
import { StatusTag } from '../../components/ui/status-tag';
import { formatAccessSummaryList } from '../access/access-display';
import type { UserActionHandler } from './user-actions';
import { readUserStatusTagPresentation, type UserStatusTagPresentation } from './user-status-labels';
import { UserActionControls } from './users-table.actions';

interface UserRowProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onUserAction: UserActionHandler;
  organizationSlug: string;
  user: BrowserUsersUser;
}

interface UserStatusBadgeProps {
  access: BrowserUsersAccessState;
  status: BrowserUsersAccountStatus;
  type: BrowserUsersUserType;
}

export function UserRow(props: Readonly<UserRowProps>): JSX.Element {
  const { data, onNavigate, onUserAction, organizationSlug, user } = props;

  return (
    <ServerTableRow>
      <ServerTableCell className="font-medium">{user.email}</ServerTableCell>
      <ServerTableCell>
        <UserStatusBadge access={user.access} status={user.status} type={user.type} />
      </ServerTableCell>
      <ServerTableCell>{renderUserGroupSummary(user)}</ServerTableCell>
      <ServerTableCell>{renderUserAccessSummary(user)}</ServerTableCell>
      <ServerTableCell>{renderUserDirectAccessSummary(user)}</ServerTableCell>
      <ServerTableCell align="right">
        <UserActionControls
          data={data}
          onNavigate={onNavigate}
          onUserAction={onUserAction}
          organizationSlug={organizationSlug}
          user={user}
        />
      </ServerTableCell>
    </ServerTableRow>
  );
}

function UserStatusBadge({ access, status, type }: Readonly<UserStatusBadgeProps>): JSX.Element {
  const presentation: UserStatusTagPresentation = readUserStatusTagPresentation({ access, status, type });

  return <StatusTag icon={presentation.icon} label={presentation.label} variant={presentation.variant} />;
}

function renderUserAccessSummary(user: BrowserUsersUser): JSX.Element {
  if (user.type === 'automation') {
    return <span className="text-[12px] text-muted-foreground">Managed by Git source</span>;
  }

  return <span className="text-[12px]">{user.accessSummary}</span>;
}

function renderUserDirectAccessSummary(user: BrowserUsersUser): JSX.Element {
  if (user.type === 'automation') {
    return <span className="text-[12px] text-muted-foreground">System-managed</span>;
  }

  return (
    <span className="text-[12px] text-muted-foreground">
      {formatAccessSummaryList(user.directAccessScopeLabels, 'None')}
    </span>
  );
}

function renderUserGroupSummary(user: BrowserUsersUser): JSX.Element {
  if (user.type === 'automation') {
    return <span className="text-[12px] text-muted-foreground">System</span>;
  }

  return <span className="text-[12px]">{formatAccessSummaryList(user.groupNames, 'No groups')}</span>;
}
