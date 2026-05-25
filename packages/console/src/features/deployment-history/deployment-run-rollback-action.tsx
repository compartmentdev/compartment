import { useState, type FormEvent, type JSX } from 'react';
import { type DeploymentReadRunGroup, type DeploymentReadSummary } from '@compartment/contracts/browser';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { canRollbackBrowserDeployments } from '../console/console-access';
import {
  readRollbackDeploymentRunConfirmationMessage,
  rollbackDeploymentRun,
  toDeploymentHistoryActionError,
  type DeploymentHistoryRollbackHandler,
  type DeploymentHistoryActionErrorLike,
  type RollbackDeploymentRunInput,
} from './deployment-history-actions';

interface DeploymentRunRollbackMenuItemProps {
  data: BrowserDeploymentHistoryPageResult;
  onRollback: DeploymentHistoryRollbackHandler;
  run: DeploymentReadRunGroup;
}

type DeploymentRunRollbackSubmittingSetter = (value: boolean) => void;
type DeploymentRunRollbackSubmitHandler = (event: FormEvent<HTMLFormElement>) => void;

interface DeploymentRunRollbackContext {
  environmentName: string;
  organizationSlug: string;
}

interface EnabledDeploymentRunRollbackState {
  input: RollbackDeploymentRunInput;
  kind: 'enabled';
}

interface DisabledDeploymentRunRollbackState {
  kind: 'disabled';
  reason: string;
}

interface HiddenDeploymentRunRollbackState {
  kind: 'hidden';
}

interface EnabledDeploymentRunRollbackMenuItemProps {
  input: RollbackDeploymentRunInput;
  isSubmitting: boolean;
  onRollback: DeploymentHistoryRollbackHandler;
  setIsSubmitting: DeploymentRunRollbackSubmittingSetter;
}

type DeploymentRunRollbackState =
  | DisabledDeploymentRunRollbackState
  | EnabledDeploymentRunRollbackState
  | HiddenDeploymentRunRollbackState;

export function DeploymentRunRollbackMenuItem({
  data,
  onRollback,
  run,
}: Readonly<DeploymentRunRollbackMenuItemProps>): JSX.Element | null {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const state: DeploymentRunRollbackState = readRollbackDeploymentRunState(data, run);
  if (state.kind === 'hidden') {
    return null;
  }
  if (state.kind === 'disabled') {
    return <DisabledDeploymentRunRollbackMenuItem reason={state.reason} />;
  }

  return (
    <EnabledDeploymentRunRollbackMenuItem
      input={state.input}
      isSubmitting={isSubmitting}
      onRollback={onRollback}
      setIsSubmitting={setIsSubmitting}
    />
  );
}

function EnabledDeploymentRunRollbackMenuItem({
  input,
  isSubmitting,
  onRollback,
  setIsSubmitting,
}: Readonly<EnabledDeploymentRunRollbackMenuItemProps>): JSX.Element {
  const onSubmit: DeploymentRunRollbackSubmitHandler = (event: FormEvent<HTMLFormElement>): void =>
    void handleSubmit(event, input, isSubmitting, onRollback, setIsSubmitting);

  return (
    <form onSubmit={onSubmit}>
      <DropdownMenuItem asChild disabled={isSubmitting}>
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Rolling back...' : 'Rollback'}
        </button>
      </DropdownMenuItem>
    </form>
  );
}

function DisabledDeploymentRunRollbackMenuItem({
  reason,
}: Readonly<Pick<DisabledDeploymentRunRollbackState, 'reason'>>): JSX.Element {
  return (
    <DropdownMenuItem className="cursor-not-allowed flex-col items-start gap-0.5" disabled title={reason}>
      <span>Rollback</span>
      <span className="text-[11px] text-muted-foreground">{reason}</span>
    </DropdownMenuItem>
  );
}

function readRollbackDeploymentRunState(
  data: BrowserDeploymentHistoryPageResult,
  run: DeploymentReadRunGroup,
): DeploymentRunRollbackState {
  const context: DeploymentRunRollbackContext | null = readDeploymentRunRollbackContext(data);
  if (context === null) {
    return { kind: 'hidden' };
  }

  const disabledReason: string | null = readDisabledDeploymentRunRollbackReason(data, run);
  if (disabledReason !== null) {
    return {
      kind: 'disabled',
      reason: disabledReason,
    };
  }

  return buildEnabledDeploymentRunRollbackState(data, run, context);
}

function readDeploymentRunRollbackContext(
  data: BrowserDeploymentHistoryPageResult,
): DeploymentRunRollbackContext | null {
  if (
    data.environmentName === null ||
    data.selectedOrganizationSlug === null ||
    !canRollbackBrowserDeployments(data.currentEnvironmentPermissions)
  ) {
    return null;
  }

  return {
    environmentName: data.environmentName,
    organizationSlug: data.selectedOrganizationSlug,
  };
}

function buildEnabledDeploymentRunRollbackState(
  data: BrowserDeploymentHistoryPageResult,
  run: DeploymentReadRunGroup,
  context: DeploymentRunRollbackContext,
): EnabledDeploymentRunRollbackState {
  return {
    input: {
      environmentName: context.environmentName,
      organizationSlug: context.organizationSlug,
      projectName: data.projectName,
      targetDeploymentRunId: run.deploymentRunId,
    },
    kind: 'enabled',
  };
}

function readDisabledDeploymentRunRollbackReason(
  data: BrowserDeploymentHistoryPageResult,
  run: DeploymentReadRunGroup,
): string | null {
  const activeServiceNames: Set<string> = new Set<string>(
    data.deployments
      .filter((deployment: DeploymentReadSummary): boolean => deployment.isActive)
      .map((deployment: DeploymentReadSummary): string => deployment.serviceName),
  );

  const runServiceNames: Set<string> = new Set<string>(
    run.deployments.map((deployment: DeploymentReadSummary): string => deployment.serviceName),
  );
  for (const serviceName of activeServiceNames) {
    if (!runServiceNames.has(serviceName)) {
      return 'Run does not match active services';
    }
  }

  for (const deployment of run.deployments) {
    const reason: string | null = readDisabledDeploymentRollbackReason(deployment);
    if (reason !== null) {
      return reason;
    }
  }

  return null;
}

function readDisabledDeploymentRollbackReason(deployment: DeploymentReadSummary): string | null {
  if (deployment.rollbackAvailable) {
    return null;
  }
  if (deployment.isActive) {
    return 'Current active run';
  }
  if (deployment.status !== 'succeeded') {
    return 'Run did not succeed';
  }
  if (deployment.reusableImageState === 'cleaned') {
    return 'Image cleaned by retention';
  }
  if (deployment.reusableImageState === 'missing') {
    return 'Image missing';
  }

  return 'Rollback unavailable';
}

async function handleSubmit(
  event: FormEvent<HTMLFormElement>,
  input: Readonly<RollbackDeploymentRunInput>,
  isSubmitting: boolean,
  onRollback: DeploymentHistoryRollbackHandler,
  setIsSubmitting: DeploymentRunRollbackSubmittingSetter,
): Promise<void> {
  event.preventDefault();
  if (isSubmitting || !window.confirm(readRollbackDeploymentRunConfirmationMessage(input))) {
    return;
  }

  setIsSubmitting(true);
  try {
    await onRollback(await rollbackDeploymentRun(input));
  } catch (error) {
    await onRollback(undefined, toDeploymentHistoryActionError(error as DeploymentHistoryActionErrorLike));
  } finally {
    setIsSubmitting(false);
  }
}
