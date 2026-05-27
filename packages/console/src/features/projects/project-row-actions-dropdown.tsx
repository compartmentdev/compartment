import type { JSX } from 'react';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import { type ProjectAction, type ProjectActionHandler } from './project-actions';
import {
  ProjectActionConfirmationDialog,
  type ProjectActionController,
  readCloseProjectConfirmationDialogHandler,
  useProjectActionController,
} from './project-row-actions-dropdown.confirmation';
import { renderProjectOpenMenuItems } from './project-open-action';

interface ProjectRowActionsDropdownProps {
  data: BrowserProjectsPageResult;
  onProjectAction: ProjectActionHandler;
  project: BrowserProjectSummary;
}

interface ProjectRowActionsDropdownContentProps {
  actions: readonly ProjectRowMenuAction[];
  onProjectAction: ProjectActionHandler;
  openItems: readonly JSX.Element[];
  organizationSlug: string;
  project: BrowserProjectSummary;
}

interface ProjectRowMenuAction {
  action: ProjectAction;
  label: string;
}

interface ProjectActionMenuItemProps {
  action: ProjectAction;
  isDisabled: boolean;
  isPending: boolean;
  label: string;
  onSelect: (action: ProjectAction) => void;
}

interface ProjectActionsMenuProps {
  actions: readonly ProjectRowMenuAction[];
  pendingAction: ProjectAction | undefined;
  onSelect: (action: ProjectAction) => void;
  openItems: readonly JSX.Element[];
  projectName: string;
}

export function ProjectRowActionsDropdown({
  data,
  onProjectAction,
  project,
}: Readonly<ProjectRowActionsDropdownProps>): JSX.Element | null {
  if (data.selectedOrganizationSlug === null) {
    return null;
  }

  const openItems: JSX.Element[] = renderProjectOpenMenuItems({ project });
  const actions: ProjectRowMenuAction[] = listProjectRowMenuActions(project);
  if (openItems.length === 0 && actions.length === 0) {
    return null;
  }

  return (
    <ProjectRowActionsDropdownContent
      actions={actions}
      onProjectAction={onProjectAction}
      openItems={openItems}
      organizationSlug={data.selectedOrganizationSlug}
      project={project}
    />
  );
}

function ProjectRowActionsDropdownContent(props: Readonly<ProjectRowActionsDropdownContentProps>): JSX.Element {
  const controller: ProjectActionController = useProjectActionController(
    props.project.name,
    props.organizationSlug,
    props.onProjectAction,
  );

  return (
    <>
      <ProjectActionsMenu
        actions={props.actions}
        pendingAction={controller.pendingAction}
        onSelect={controller.requestAction}
        openItems={props.openItems}
        projectName={props.project.name}
      />
      <ProjectActionConfirmationDialog
        action={controller.confirmationAction}
        isPending={controller.isPending}
        onConfirm={controller.submitConfirmedAction}
        onOpenChange={readCloseProjectConfirmationDialogHandler(controller.setConfirmationAction)}
        projectName={props.project.name}
      />
    </>
  );
}

function listProjectRowMenuActions(project: BrowserProjectSummary): ProjectRowMenuAction[] {
  const actions: ProjectRowMenuAction[] = [];
  appendProjectLifecycleMenuAction(actions, project);
  appendProjectArchiveMenuActions(actions, project);
  return actions;
}

function appendProjectLifecycleMenuAction(actions: ProjectRowMenuAction[], project: BrowserProjectSummary): void {
  if (project.lifecycleAction === null) {
    return;
  }

  actions.push({
    action: project.lifecycleAction,
    label: project.lifecycleAction === 'start' ? 'Start' : 'Stop',
  });
}

function appendProjectArchiveMenuActions(actions: ProjectRowMenuAction[], project: BrowserProjectSummary): void {
  if (!project.canManageArchive) {
    return;
  }
  if (project.status === 'archived') {
    actions.push({ action: 'unarchive', label: 'Unarchive' }, { action: 'delete', label: 'Remove' });
    return;
  }

  actions.push({ action: 'archive', label: 'Archive' });
}

function ProjectActionsMenu({
  actions,
  pendingAction,
  onSelect,
  openItems,
  projectName,
}: Readonly<ProjectActionsMenuProps>): JSX.Element {
  return (
    <ServerTableActionsMenu ariaLabel={`Open actions for ${projectName}`}>
      {openItems}
      {renderProjectActionMenuItems(actions, pendingAction, onSelect)}
    </ServerTableActionsMenu>
  );
}

function renderProjectActionMenuItems(
  actions: readonly ProjectRowMenuAction[],
  pendingAction: ProjectAction | undefined,
  onSelect: (action: ProjectAction) => void,
): JSX.Element[] {
  return actions.map(
    (action: ProjectRowMenuAction): JSX.Element => (
      <ProjectActionMenuItem
        action={action.action}
        isDisabled={pendingAction !== undefined}
        isPending={pendingAction === action.action}
        key={action.action}
        label={action.label}
        onSelect={onSelect}
      />
    ),
  );
}

function ProjectActionMenuItem({
  action,
  isDisabled,
  isPending,
  label,
  onSelect,
}: Readonly<ProjectActionMenuItemProps>): JSX.Element {
  return (
    <DropdownMenuItem
      className={
        action === 'delete' ? 'text-destructive focus:text-destructive data-[highlighted]:text-destructive' : undefined
      }
      disabled={isDisabled}
      onSelect={(): void => {
        if (!isDisabled) {
          onSelect(action);
        }
      }}
    >
      {isPending ? readPendingProjectActionLabel(action) : label}
    </DropdownMenuItem>
  );
}

function readPendingProjectActionLabel(action: ProjectAction): string {
  switch (action) {
    case 'archive':
      return 'Archiving...';
    case 'delete':
      return 'Removing...';
    case 'start':
      return 'Starting...';
    case 'stop':
      return 'Stopping...';
    case 'unarchive':
      return 'Unarchiving...';
  }
}
