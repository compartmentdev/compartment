import { useState, type JSX } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { runProjectAction, type ProjectAction, type ProjectActionHandler } from './project-actions';

interface ProjectActionConfirmationDialogProps {
  action: ConfirmableProjectAction | null;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  projectName: string;
}

interface ProjectActionConfirmationSpec {
  confirmLabel: string;
  description: string;
  expectedValue: string;
  inputLabel: 'Project name';
  inputPlaceholder: string;
  title: string;
}

export interface ProjectActionController {
  confirmationAction: ConfirmableProjectAction | null;
  isPending: boolean;
  pendingAction: ProjectAction | undefined;
  requestAction: (action: ProjectAction) => void;
  setConfirmationAction: (action: ConfirmableProjectAction | null) => void;
  submitConfirmedAction: () => void;
}

type ConfirmableProjectAction = Extract<ProjectAction, 'archive' | 'delete'>;
type ProjectActionMutation = UseMutationResult<void, Error, ProjectAction>;

class ProjectActionControllerValue implements ProjectActionController {
  public constructor(
    public readonly confirmationAction: ConfirmableProjectAction | null,
    public readonly isPending: boolean,
    public readonly pendingAction: ProjectAction | undefined,
    public readonly requestAction: (action: ProjectAction) => void,
    public readonly setConfirmationAction: (action: ConfirmableProjectAction | null) => void,
    public readonly submitConfirmedAction: () => void,
  ) {}
}

export function useProjectActionController(
  projectName: string,
  organizationSlug: string,
  onProjectAction: ProjectActionHandler,
): ProjectActionController {
  const [confirmationAction, setConfirmationAction] = useState<ConfirmableProjectAction | null>(null);
  const mutation: ProjectActionMutation = useProjectActionMutation(projectName, organizationSlug, onProjectAction);
  const requestAction: (action: ProjectAction) => void = (action: ProjectAction): void =>
    requestProjectAction(action, mutation, setConfirmationAction);
  const submitConfirmedAction: () => void = (): void =>
    submitConfirmedProjectAction(confirmationAction, mutation, setConfirmationAction);

  return new ProjectActionControllerValue(
    confirmationAction,
    mutation.isPending,
    mutation.isPending ? mutation.variables : undefined,
    requestAction,
    setConfirmationAction,
    submitConfirmedAction,
  );
}

export function readCloseProjectConfirmationDialogHandler(
  setConfirmationAction: (action: ConfirmableProjectAction | null) => void,
): (open: boolean) => void {
  return (): void => setConfirmationAction(null);
}

export function ProjectActionConfirmationDialog(
  props: Readonly<ProjectActionConfirmationDialogProps>,
): JSX.Element | null {
  const spec: ProjectActionConfirmationSpec | null = readProjectActionConfirmationSpec(props.action, props.projectName);
  if (spec === null || props.action === null) {
    return null;
  }

  return (
    <ConfirmationDialog
      confirmLabel={spec.confirmLabel}
      description={spec.description}
      expectedValue={spec.expectedValue}
      inputLabel={spec.inputLabel}
      inputPlaceholder={spec.inputPlaceholder}
      isPending={props.isPending}
      onConfirm={props.onConfirm}
      onOpenChange={props.onOpenChange}
      open
      title={spec.title}
    />
  );
}

function requestProjectAction(
  action: ProjectAction,
  mutation: ProjectActionMutation,
  setConfirmationAction: (action: ConfirmableProjectAction | null) => void,
): void {
  if (action === 'archive' || action === 'delete') {
    setConfirmationAction(action);
    return;
  }

  mutation.mutate(action);
}

function submitConfirmedProjectAction(
  confirmationAction: ConfirmableProjectAction | null,
  mutation: ProjectActionMutation,
  setConfirmationAction: (action: ConfirmableProjectAction | null) => void,
): void {
  if (confirmationAction === null) {
    return;
  }

  setConfirmationAction(null);
  mutation.mutate(confirmationAction);
}

function useProjectActionMutation(
  projectName: string,
  organizationSlug: string,
  onProjectAction: ProjectActionHandler,
): ProjectActionMutation {
  return useBrowserMutation<void, ProjectAction>({
    mutation: async (action: ProjectAction): Promise<void> =>
      await runProjectAction(action, projectName, organizationSlug),
    mutationKey: ['console-projects', organizationSlug, projectName, 'action'],
    onError: (error: Error, action: ProjectAction): void => {
      void onProjectAction(action, projectName, error);
    },
    onSuccess: async (_: void, action: ProjectAction): Promise<void> => {
      await onProjectAction(action, projectName);
    },
  });
}

function readProjectActionConfirmationSpec(
  action: ConfirmableProjectAction | null,
  projectName: string,
): ProjectActionConfirmationSpec | null {
  switch (action) {
    case 'archive':
      return readArchiveProjectActionConfirmationSpec(projectName);
    case 'delete':
      return readDeleteProjectActionConfirmationSpec(projectName);
    case null:
      return null;
  }
}

function readArchiveProjectActionConfirmationSpec(projectName: string): ProjectActionConfirmationSpec {
  return {
    confirmLabel: 'Archive project',
    description: `Type ${projectName} to archive this project.`,
    expectedValue: projectName,
    inputLabel: 'Project name',
    inputPlaceholder: projectName,
    title: 'Archive project',
  };
}

function readDeleteProjectActionConfirmationSpec(projectName: string): ProjectActionConfirmationSpec {
  return {
    confirmLabel: 'Remove project',
    description: `Type ${projectName} to permanently remove this project.`,
    expectedValue: projectName,
    inputLabel: 'Project name',
    inputPlaceholder: projectName,
    title: 'Remove project',
  };
}
