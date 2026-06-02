import { useState, type JSX } from 'react';
import type { DeploymentReadRunGroup } from '@compartment/contracts/browser';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { ServerTableActionLink, ServerTableActions } from '../../components/server-table';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import {
  readRollbackDeploymentRunConfirmationMessage,
  rollbackDeploymentRun,
  toDeploymentHistoryActionError,
  type DeploymentHistoryActionErrorLike,
  type DeploymentHistoryRollbackHandler,
  type RollbackDeploymentRunInput,
} from './deployment-history-actions';
import { buildDeploymentDetailsHref } from './deployment-history-query';
import {
  DeploymentRunRollbackMenuItem,
  readRollbackDeploymentRunState,
  type DeploymentRunRollbackState,
} from './deployment-run-rollback-action';

interface DeploymentHistoryTableActionsProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onRollback: DeploymentHistoryRollbackHandler;
  run: DeploymentReadRunGroup;
}

interface DeploymentHistoryDetailsActionProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  run: DeploymentReadRunGroup;
}

interface DeploymentHistoryActionsMenuProps extends DeploymentHistoryTableActionsProps {
  isSubmitting: boolean;
  onRequestRollback: (open: boolean) => void;
  rollbackState: DeploymentRunRollbackState;
}

interface DeploymentHistoryTableActionsContentProps {
  props: DeploymentHistoryTableActionsProps;
  state: DeploymentHistoryTableActionsState;
}

interface DeploymentHistoryRollbackConfirmationDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  rollbackState: DeploymentRunRollbackState;
}

interface DeploymentHistoryTableActionsState {
  isRollbackDialogOpen: boolean;
  isSubmitting: boolean;
  rollbackState: DeploymentRunRollbackState;
  setIsRollbackDialogOpen: (open: boolean) => void;
  setIsSubmitting: (value: boolean) => void;
}

export function DeploymentHistoryTableActions(props: Readonly<DeploymentHistoryTableActionsProps>): JSX.Element {
  return <DeploymentHistoryTableActionsContent props={props} state={useDeploymentHistoryTableActionsState(props)} />;
}

function useDeploymentHistoryTableActionsState(
  props: Readonly<DeploymentHistoryTableActionsProps>,
): DeploymentHistoryTableActionsState {
  const [isRollbackDialogOpen, setIsRollbackDialogOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  return {
    isRollbackDialogOpen,
    isSubmitting,
    rollbackState: readRollbackDeploymentRunState(props.data, props.run),
    setIsRollbackDialogOpen,
    setIsSubmitting,
  };
}

function DeploymentHistoryTableActionsContent({
  props,
  state,
}: Readonly<DeploymentHistoryTableActionsContentProps>): JSX.Element {
  return (
    <>
      <DeploymentHistoryActionsMenu
        data={props.data}
        isSubmitting={state.isSubmitting}
        onNavigate={props.onNavigate}
        onRequestRollback={state.setIsRollbackDialogOpen}
        onRollback={props.onRollback}
        rollbackState={state.rollbackState}
        run={props.run}
      />
      <DeploymentHistoryRollbackConfirmationDialog
        isOpen={state.isRollbackDialogOpen}
        isSubmitting={state.isSubmitting}
        onConfirm={readRollbackConfirmHandler(props.onRollback, state)}
        onOpenChange={state.setIsRollbackDialogOpen}
        rollbackState={state.rollbackState}
      />
    </>
  );
}

function DeploymentHistoryActionsMenu({
  data,
  isSubmitting,
  onNavigate,
  onRequestRollback,
  rollbackState,
  run,
}: Readonly<DeploymentHistoryActionsMenuProps>): JSX.Element {
  return (
    <ServerTableActions>
      <DeploymentHistoryDetailsAction data={data} onNavigate={onNavigate} run={run} />
      {renderDeploymentHistoryActionsDropdown(run, rollbackState, isSubmitting, onRequestRollback)}
    </ServerTableActions>
  );
}

function renderDeploymentHistoryActionsDropdown(
  run: Readonly<DeploymentReadRunGroup>,
  rollbackState: DeploymentRunRollbackState,
  isSubmitting: boolean,
  onRequestRollback: (open: boolean) => void,
): JSX.Element | null {
  if (rollbackState.kind === 'hidden') {
    return null;
  }

  return (
    <ServerTableActionsMenu ariaLabel={`Open actions for ${run.label}`}>
      <DeploymentRunRollbackMenuItem
        isSubmitting={isSubmitting}
        onSelect={(): void => onRequestRollback(true)}
        state={rollbackState}
      />
    </ServerTableActionsMenu>
  );
}

function DeploymentHistoryRollbackConfirmationDialog({
  isOpen,
  isSubmitting,
  onConfirm,
  onOpenChange,
  rollbackState,
}: Readonly<DeploymentHistoryRollbackConfirmationDialogProps>): JSX.Element | null {
  if (rollbackState.kind !== 'enabled') {
    return null;
  }

  return (
    <ConfirmationDialog
      confirmLabel="Rollback deployment"
      description={readRollbackDeploymentRunConfirmationMessage(rollbackState.input)}
      isPending={isSubmitting}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={isOpen}
      title="Rollback deployment"
    />
  );
}

function readRollbackConfirmHandler(
  onRollback: DeploymentHistoryRollbackHandler,
  state: Readonly<DeploymentHistoryTableActionsState>,
): () => void {
  return (): void => {
    if (state.rollbackState.kind === 'enabled') {
      state.setIsRollbackDialogOpen(false);
      void handleRollbackConfirm(state.rollbackState.input, onRollback, state.setIsSubmitting);
    }
  };
}

function DeploymentHistoryDetailsAction({
  data,
  onNavigate,
  run,
}: Readonly<DeploymentHistoryDetailsActionProps>): JSX.Element {
  return (
    <ServerTableActionLink
      href={buildDeploymentDetailsHref(
        {
          environmentName: data.environmentName,
          organizationSlug: data.selectedOrganizationSlug,
          projectName: data.projectName,
        },
        run.deploymentRunId,
      )}
      onNavigate={onNavigate}
    >
      Details
    </ServerTableActionLink>
  );
}

async function handleRollbackConfirm(
  input: Readonly<RollbackDeploymentRunInput>,
  onRollback: DeploymentHistoryRollbackHandler,
  setIsSubmitting: (value: boolean) => void,
): Promise<void> {
  setIsSubmitting(true);
  try {
    await onRollback(await rollbackDeploymentRun(input));
  } catch (error) {
    await onRollback(undefined, toDeploymentHistoryActionError(error as DeploymentHistoryActionErrorLike));
  } finally {
    setIsSubmitting(false);
  }
}
