import type { JSX } from 'react';
import { type DeploymentReadRunGroup, type DeploymentReadSummary } from '@compartment/contracts/browser';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { canRollbackBrowserDeployments } from '../console/console-access';
import type { RollbackDeploymentRunInput } from './deployment-history-actions';

interface DeploymentRunRollbackMenuItemProps {
  isSubmitting: boolean;
  onSelect: () => void;
  state: DeploymentRunRollbackState;
}

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

export type DeploymentRunRollbackState =
  | DisabledDeploymentRunRollbackState
  | EnabledDeploymentRunRollbackState
  | HiddenDeploymentRunRollbackState;

export function DeploymentRunRollbackMenuItem({
  isSubmitting,
  onSelect,
  state,
}: Readonly<DeploymentRunRollbackMenuItemProps>): JSX.Element | null {
  if (state.kind === 'hidden') {
    return null;
  }
  if (state.kind === 'disabled') {
    return <DisabledDeploymentRunRollbackMenuItem reason={state.reason} />;
  }

  return <EnabledDeploymentRunRollbackMenuItem isSubmitting={isSubmitting} onSelect={onSelect} />;
}

function EnabledDeploymentRunRollbackMenuItem({
  isSubmitting,
  onSelect,
}: Readonly<{ isSubmitting: boolean; onSelect: () => void }>): JSX.Element {
  return (
    <DropdownMenuItem
      disabled={isSubmitting}
      onSelect={(): void => {
        if (!isSubmitting) {
          onSelect();
        }
      }}
    >
      {isSubmitting ? 'Rolling back...' : 'Rollback'}
    </DropdownMenuItem>
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

export function readRollbackDeploymentRunState(
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
