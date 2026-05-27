import type { JSX } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
  browserConsoleListPageBodyClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { UserPlus } from '../../components/ui/icons';
import { readBrowserTablePageSize } from '../../lib/server-table-query';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { AccessPageHeader } from '../access/access-ui';
import { canInviteBrowserUsers } from '../console/console-access';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { UserAccessPanel } from './user-access-panel';
import type { UserActionHandler } from './user-actions';
import { shouldRenderUsersEmptyState, UsersEmptyState } from './users-empty-state';
import { UsersTable } from './users-table';
import { buildUsersHref } from './users-query';

interface UsersViewProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onUserAction: UserActionHandler;
  setData: (value: BrowserUsersPageResult | ((current: BrowserUsersPageResult) => BrowserUsersPageResult)) => void;
}

interface UsersToolbarProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface UsersPageHeaderProps extends UsersToolbarProps {
  showInviteAction: boolean;
}

interface UsersTableSectionProps {
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onUserAction: UserActionHandler;
}

interface UsersOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  data: BrowserUsersPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function UsersView({ data, onNavigate, onUserAction, setData }: Readonly<UsersViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);

  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={data.currentOrganizationPermissions}
      organizationControl={organizationControl}
      onNavigate={onNavigate}
      page="users"
      principalEmail={data.principalEmail}
      projectCount={data.projectCount}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      <UsersPageBody data={data} onNavigate={onNavigate} onUserAction={onUserAction} />
      {data.organizationContext.kind === 'selected' ? (
        <UserAccessPanel data={data} onNavigate={onNavigate} setData={setData} />
      ) : null}
    </BrowserConsoleShell>
  );
}

function UsersPageBody({
  data,
  onNavigate,
  onUserAction,
}: Readonly<Pick<UsersViewProps, 'data' | 'onNavigate' | 'onUserAction'>>): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <UsersPageHeader data={data} onNavigate={onNavigate} showInviteAction={!shouldRenderUsersEmptyState(data)} />
      <div className={browserConsoleListPageBodyClassName}>
        <DismissibleAlert message={data.noticeMessage} variant="notice" />
        <DismissibleAlert message={data.errorMessage} variant="error" />
        {renderUsersContent(data, onNavigate, onUserAction)}
      </div>
    </div>
  );
}

function renderUsersContent(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onUserAction: UserActionHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return <UsersOrganizationContextPanel context={data.organizationContext} data={data} onNavigate={onNavigate} />;
  }

  if (shouldRenderUsersEmptyState(data)) {
    return <UsersEmptyState data={data} onNavigate={onNavigate} />;
  }

  return (
    <>
      <UsersToolbar data={data} onNavigate={onNavigate} />
      <UsersTableSection data={data} onNavigate={onNavigate} onUserAction={onUserAction} />
    </>
  );
}

function UsersOrganizationContextPanel({
  context,
  data,
  onNavigate,
}: Readonly<UsersOrganizationContextPanelProps>): JSX.Element {
  return (
    <BrowserConsoleOrganizationContextPanel
      context={context}
      onNavigate={onNavigate}
      organizations={data.organizations}
      readOrganizationHref={(organizationSlug: string): string => readUsersOrganizationHref(data, organizationSlug)}
    />
  );
}

function readUsersOrganizationHref(data: BrowserUsersPageResult, organizationSlug: string): string {
  return buildUsersHref(data, {
    mode: 'list',
    page: 1,
    selectedOrganizationSlug: organizationSlug,
    selectedUserEmail: null,
  });
}

function UsersPageHeader({ data, onNavigate, showInviteAction }: Readonly<UsersPageHeaderProps>): JSX.Element {
  return (
    <header className={browserConsolePageHeaderClassName}>
      <AccessPageHeader
        action={<InviteUserButton data={data} onNavigate={onNavigate} showInviteAction={showInviteAction} />}
        title="Users"
      />
    </header>
  );
}

function readOrganizationControl(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      handleOrganizationChange(data, onNavigate, organizationSlug);
    },
  );
}

function UsersToolbar({ data, onNavigate }: Readonly<UsersToolbarProps>): JSX.Element {
  return (
    <header>
      <ServerSearch
        className="w-full max-w-none"
        hasLeadingSearchIcon
        label="Search users"
        onSearch={(searchQuery: string): void => {
          handleSearchChange(data, onNavigate, searchQuery);
        }}
        placeholder="Search users"
        value={data.searchQuery}
      />
    </header>
  );
}

function InviteUserButton({ data, onNavigate, showInviteAction }: Readonly<UsersPageHeaderProps>): JSX.Element | null {
  if (!showInviteAction || !canInviteBrowserUsers(data.currentOrganizationPermissions)) {
    return null;
  }

  return (
    <ToolbarPrimaryActionButton
      icon={UserPlus}
      onClick={(): void => {
        onNavigate(buildUsersHref(data, { mode: 'create', page: 1, selectedUserEmail: null }));
      }}
      type="button"
      variant="accent"
    >
      Invite user
    </ToolbarPrimaryActionButton>
  );
}

function UsersTableSection({ data, onNavigate, onUserAction }: Readonly<UsersTableSectionProps>): JSX.Element {
  if (shouldRenderUsersEmptyState(data)) {
    return <UsersEmptyState data={data} onNavigate={onNavigate} />;
  }

  return <UsersTableFrameSection data={data} onNavigate={onNavigate} onUserAction={onUserAction} />;
}

function UsersTableFrameSection({ data, onNavigate, onUserAction }: Readonly<UsersTableSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <UsersTable data={data} onNavigate={onNavigate} onUserAction={onUserAction} />
      <ServerTableControls
        currentPage={data.page}
        itemLabel="user"
        nextPageHref={readNextPageHref(data)}
        onNavigate={onNavigate}
        onPageSizeChange={(value: string): void => {
          handlePageSizeChange(data, onNavigate, value);
        }}
        pageSize={String(data.pageSize)}
        pageSizeOptions={data.pageSizeOptions.map(String)}
        previousPageHref={readPreviousPageHref(data)}
        totalItems={data.totalUsers}
        totalPages={data.totalPages}
      />
    </ServerTableFrame>
  );
}

function readNextPageHref(data: BrowserUsersPageResult): string | null {
  return data.page < data.totalPages ? buildUsersHref(data, { page: data.page + 1 }) : null;
}

function readPreviousPageHref(data: BrowserUsersPageResult): string | null {
  return data.page > 1 ? buildUsersHref(data, { page: data.page - 1 }) : null;
}

function handleOrganizationChange(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  organizationSlug: string,
): void {
  onNavigate(
    buildUsersHref(data, {
      mode: 'list',
      page: 1,
      selectedOrganizationSlug: organizationSlug,
      selectedUserEmail: null,
    }),
  );
}

function handlePageSizeChange(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  value: string,
): void {
  onNavigate(buildUsersHref(data, { page: 1, pageSize: readBrowserTablePageSize(value) }));
}

function handleSearchChange(
  data: BrowserUsersPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  searchQuery: string,
): void {
  onNavigate(buildUsersHref(data, { page: 1, searchQuery }));
}
