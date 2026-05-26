import type { JSX } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import {
  readProjectActionConfirmationMessage,
  runProjectAction,
  type ProjectAction,
  type ProjectActionHandler,
} from './project-actions';
import { renderProjectOpenMenuItems } from './project-open-action';

interface ProjectRowActionsDropdownProps {
  data: BrowserProjectsPageResult;
  onProjectAction: ProjectActionHandler;
  project: BrowserProjectSummary;
}

interface ProjectRowMenuAction {
  action: ProjectAction;
  label: string;
}

interface ProjectActionMenuItemProps {
  action: ProjectAction;
  label: string;
  onProjectAction: ProjectActionHandler;
  organizationSlug: string;
  projectName: string;
}

type ProjectActionMutation = UseMutationResult<void, Error, void>;

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
    <ServerTableActionsMenu ariaLabel={`Open actions for ${project.name}`}>
      {openItems}
      {renderProjectActionMenuItems(actions, onProjectAction, data.selectedOrganizationSlug, project.name)}
    </ServerTableActionsMenu>
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
    appendArchivedProjectMenuActions(actions);
    return;
  }

  actions.push({
    action: 'archive',
    label: 'Archive',
  });
}

function appendArchivedProjectMenuActions(actions: ProjectRowMenuAction[]): void {
  actions.push(
    {
      action: 'unarchive',
      label: 'Unarchive',
    },
    {
      action: 'delete',
      label: 'Remove',
    },
  );
}

function renderProjectActionMenuItems(
  actions: readonly ProjectRowMenuAction[],
  onProjectAction: ProjectActionHandler,
  organizationSlug: string,
  projectName: string,
): JSX.Element[] {
  return actions.map(
    (action: ProjectRowMenuAction): JSX.Element => (
      <ProjectActionMenuItem
        action={action.action}
        key={action.action}
        label={action.label}
        onProjectAction={onProjectAction}
        organizationSlug={organizationSlug}
        projectName={projectName}
      />
    ),
  );
}

function ProjectActionMenuItem({
  action,
  label,
  onProjectAction,
  organizationSlug,
  projectName,
}: Readonly<ProjectActionMenuItemProps>): JSX.Element {
  const mutation: ProjectActionMutation = useProjectActionMutation(
    action,
    projectName,
    organizationSlug,
    onProjectAction,
  );

  return (
    <DropdownMenuItem
      className={
        action === 'delete' ? 'text-destructive focus:text-destructive data-[highlighted]:text-destructive' : undefined
      }
      disabled={mutation.isPending}
      onSelect={createProjectActionSelectHandler(action, projectName, mutation)}
    >
      {mutation.isPending ? readPendingProjectActionLabel(action) : label}
    </DropdownMenuItem>
  );
}

function useProjectActionMutation(
  action: ProjectAction,
  projectName: string,
  organizationSlug: string,
  onProjectAction: ProjectActionHandler,
): ProjectActionMutation {
  return useBrowserMutation<void>({
    mutation: async (): Promise<void> => await runProjectAction(action, projectName, organizationSlug),
    mutationKey: ['console-projects', organizationSlug, projectName, action],
    onError: (error: Error): void => {
      void onProjectAction(action, projectName, error);
    },
    onSuccess: async (): Promise<void> => {
      await onProjectAction(action, projectName);
    },
  });
}

function createProjectActionSelectHandler(
  action: ProjectAction,
  projectName: string,
  mutation: ProjectActionMutation,
): () => void {
  return (): void => {
    if (mutation.isPending || !shouldRunProjectAction(action, projectName)) {
      return;
    }

    mutation.mutate();
  };
}

function shouldRunProjectAction(action: ProjectAction, projectName: string): boolean {
  const confirmationMessage: string | null = readProjectActionConfirmationMessage(action, projectName);
  return confirmationMessage === null || window.prompt(confirmationMessage) === projectName;
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
