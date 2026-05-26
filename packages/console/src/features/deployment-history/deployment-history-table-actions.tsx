import type { JSX } from 'react';
import type { DeploymentReadRunGroup } from '@compartment/contracts/browser';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { ServerTableActions } from '../../components/server-table';
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import type { DeploymentHistoryRollbackHandler } from './deployment-history-actions';
import { buildDeploymentDetailsHref } from './deployment-history-query';
import { DeploymentRunRollbackMenuItem } from './deployment-run-rollback-action';

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

export function DeploymentHistoryTableActions({
  data,
  onNavigate,
  onRollback,
  run,
}: Readonly<DeploymentHistoryTableActionsProps>): JSX.Element {
  return (
    <ServerTableActions>
      <ServerTableActionsMenu ariaLabel={`Open actions for ${run.label}`}>
        <DeploymentHistoryDetailsAction data={data} onNavigate={onNavigate} run={run} />
        <DeploymentRunRollbackMenuItem data={data} onRollback={onRollback} run={run} />
      </ServerTableActionsMenu>
    </ServerTableActions>
  );
}

function DeploymentHistoryDetailsAction({
  data,
  onNavigate,
  run,
}: Readonly<DeploymentHistoryDetailsActionProps>): JSX.Element {
  return (
    <DropdownMenuItem asChild>
      <BrowserSoftNavigationLink
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
      </BrowserSoftNavigationLink>
    </DropdownMenuItem>
  );
}
