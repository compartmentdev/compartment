import type { JSX } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { readServerTableActionControlClassName } from '../../components/server-table';
import { Button } from '../../components/ui/button';
import { ChevronDown } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  readProjectActionConfirmationMessage,
  runProjectAction,
  type ProjectAction,
  type ProjectActionHandler,
} from './project-actions';

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

  const actions: ProjectRowMenuAction[] = listProjectRowMenuActions(data, project);
  if (actions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <ProjectRowActionsTrigger />
      <DropdownMenuContent align="end">
        {renderProjectActionMenuItems(actions, onProjectAction, data.selectedOrganizationSlug, project.name)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function listProjectRowMenuActions(
  data: BrowserProjectsPageResult,
  project: BrowserProjectSummary,
): ProjectRowMenuAction[] {
  const actions: ProjectRowMenuAction[] = [];
  appendProjectLifecycleMenuAction(actions, project);
  appendProjectArchiveMenuActions(actions, data, project);
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

function appendProjectArchiveMenuActions(
  actions: ProjectRowMenuAction[],
  data: BrowserProjectsPageResult,
  project: BrowserProjectSummary,
): void {
  if (!project.canManageArchive) {
    return;
  }
  if (data.archiveState === 'archived') {
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

function ProjectRowActionsTrigger(): JSX.Element {
  return (
    <DropdownMenuTrigger asChild>
      <Button className={readServerTableActionControlClassName()} size="sm" type="button" variant="secondary">
        Actions
        <ChevronDown className="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
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
      className={action === 'delete' ? 'text-red-700 focus:text-red-800' : undefined}
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
