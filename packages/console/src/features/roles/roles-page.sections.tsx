import type { AccessRoleListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
  browserConsoleListPageBodyClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { ShieldPlus } from '../../components/ui/icons';
import { AccessDrawerShell, AccessPageHeader } from '../access/access-ui';
import { canManageBrowserRoles } from '../console/console-access';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { RolesBackBreadcrumb } from './roles-page.back-breadcrumb';
import { RoleDetailDrawerContent, RoleDetailDrawerHeader } from './roles-page.detail-drawer';
import {
  readRoleEditorTitle,
  type RoleEditorDraftState,
  type RoleSubmitMutation,
  RoleEditorDrawerContent,
  RoleEditorDrawerFooter,
  RoleEditorDrawerHeader,
  useRoleEditorDraftState,
  useRoleSubmitMutation,
} from './roles-page.drawer';
import {
  buildRolesOrganizationHref,
  buildRolesPageHref,
  readRoleSearchText,
  type RolesBackLink,
  readRolesBackLink,
} from './roles-page.query';
import type { RolesPageState } from './roles-page.state';
import { RolesTable } from './roles-page.table';

interface RolesPageContentProps {
  state: RolesPageState;
}
interface RolesPageBodyProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  state: RolesPageState;
}
interface RolesPageHeaderProps {
  state: RolesPageState;
}
interface CreateRoleButtonProps {
  state: RolesPageState;
}
interface RolesPageToolbarProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}
interface RolesTableSectionProps {
  roles: AccessRoleListRow[];
  state: RolesPageState;
}
export function RolesPageContent({ state }: Readonly<RolesPageContentProps>): JSX.Element {
  const [searchQuery, setSearchQuery] = useState<string>('');
  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={state.data.currentOrganizationPermissions}
      organizationControl={readOrganizationControl(state)}
      onNavigate={state.onNavigate}
      page="roles"
      principalEmail={state.data.principalEmail}
      projectCount={state.data.projectCount}
      selectedOrganizationSlug={state.data.selectedOrganizationSlug}
    >
      <RolesPageBody searchQuery={searchQuery} setSearchQuery={setSearchQuery} state={state} />
      {state.data.organizationContext.kind === 'selected' ? <RolesPageDrawer state={state} /> : null}
    </BrowserConsoleShell>
  );
}

function RolesPageDrawer({ state }: Readonly<RolesPageContentProps>): JSX.Element | null {
  const editorState: RoleEditorDraftState = useRoleEditorDraftState(state);
  const mutation: RoleSubmitMutation = useRoleSubmitMutation(state, editorState);
  if (state.data.mode === 'list') {
    return null;
  }
  if (state.data.mode === 'detail') {
    const role: AccessRoleListRow | undefined = state.data.roles.find(
      (candidate: AccessRoleListRow): boolean => candidate.id === state.data.roleId,
    );
    if (role === undefined) {
      return null;
    }

    return renderRoleDetailDrawer(role, state);
  }
  if (!canManageBrowserRoles(state.data.currentOrganizationPermissions)) {
    return null;
  }
  return renderRoleEditorDrawer(editorState, mutation, state);
}

function renderRoleDetailDrawer(role: AccessRoleListRow, state: RolesPageState): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildRolesPageHref(state.data)}
      header={<RoleDetailDrawerHeader role={role} state={state} />}
      onNavigate={state.onNavigate}
      title={role.name}
    >
      <RoleDetailDrawerContent role={role} state={state} />
    </AccessDrawerShell>
  );
}

function renderRoleEditorDrawer(
  editorState: RoleEditorDraftState,
  mutation: RoleSubmitMutation,
  state: RolesPageState,
): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildRolesPageHref(state.data)}
      footer={<RoleEditorDrawerFooter mutation={mutation} state={state} />}
      header={<RoleEditorDrawerHeader state={state} />}
      onNavigate={state.onNavigate}
      title={readRoleEditorTitle(state)}
    >
      <RoleEditorDrawerContent editorState={editorState} mutation={mutation} state={state} />
    </AccessDrawerShell>
  );
}

function RolesPageBody({ searchQuery, setSearchQuery, state }: Readonly<RolesPageBodyProps>): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <RolesPageHeader state={state} />
      <div className={browserConsoleListPageBodyClassName}>
        <DismissibleAlert message={state.data.noticeMessage} variant="notice" />
        <DismissibleAlert message={state.data.errorMessage} variant="error" />
        {renderRolesPageContent(searchQuery, setSearchQuery, state)}
      </div>
    </div>
  );
}

function renderRolesPageContent(
  searchQuery: string,
  setSearchQuery: (value: string) => void,
  state: RolesPageState,
): JSX.Element {
  if (state.data.organizationContext.kind !== 'selected') {
    return (
      <BrowserConsoleOrganizationContextPanel
        context={state.data.organizationContext}
        onNavigate={state.onNavigate}
        organizations={state.data.organizations}
        readOrganizationHref={(organizationSlug: string): string => buildRolesOrganizationHref(organizationSlug)}
      />
    );
  }

  return renderSelectedRolesPageContent(searchQuery, setSearchQuery, state);
}

function renderSelectedRolesPageContent(
  searchQuery: string,
  setSearchQuery: (value: string) => void,
  state: RolesPageState,
): JSX.Element {
  const visibleRoles: AccessRoleListRow[] = readVisibleRoles(state.data.roles, searchQuery);

  return (
    <>
      <RolesPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <RolesTableSection roles={visibleRoles} state={state} />
    </>
  );
}

function RolesPageHeader({ state }: Readonly<RolesPageHeaderProps>): JSX.Element {
  const backLink: RolesBackLink | null = readRolesBackLink(state.data.backHref, state.data.selectedOrganizationSlug);

  return (
    <header className={browserConsolePageHeaderClassName}>
      <div className="flex flex-col gap-5">
        <RolesBackBreadcrumb backLink={backLink} onNavigate={state.onNavigate} />
        <AccessPageHeader action={<CreateRoleButton state={state} />} title="Roles" />
      </div>
    </header>
  );
}

function RolesPageToolbar({ searchQuery, setSearchQuery }: Readonly<RolesPageToolbarProps>): JSX.Element {
  return (
    <header>
      <ServerSearch
        className="w-full max-w-none"
        hasLeadingSearchIcon
        label="Search roles"
        onSearch={setSearchQuery}
        placeholder="Search roles"
        value={searchQuery}
      />
    </header>
  );
}

function CreateRoleButton({ state }: Readonly<CreateRoleButtonProps>): JSX.Element | null {
  if (!canManageBrowserRoles(state.data.currentOrganizationPermissions)) {
    return null;
  }
  return (
    <ToolbarPrimaryActionButton
      icon={ShieldPlus}
      onClick={(): void => {
        state.onNavigate(buildRolesPageHref(state.data, { mode: 'create' }));
      }}
      type="button"
      variant="accent"
    >
      Create role
    </ToolbarPrimaryActionButton>
  );
}

function RolesTableSection({ roles, state }: Readonly<RolesTableSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <RolesTable roles={roles} state={state} />
    </ServerTableFrame>
  );
}

function readOrganizationControl(state: RolesPageState): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    state.data.organizations,
    state.data.selectedOrganizationSlug,
    state.data.showOrganizationSelector,
    (organizationSlug: string): void => {
      state.onNavigate(buildRolesOrganizationHref(organizationSlug));
    },
  );
}

function readVisibleRoles(roles: AccessRoleListRow[], searchQuery: string): AccessRoleListRow[] {
  const normalizedSearchQuery: string = searchQuery.trim().toLowerCase();
  return roles.filter((role: AccessRoleListRow): boolean => readRoleSearchText(role).includes(normalizedSearchQuery));
}
