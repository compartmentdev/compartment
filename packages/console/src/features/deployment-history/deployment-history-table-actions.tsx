import type { JSX } from 'react';
import type { DeploymentReadRunGroup } from '@compartment/contracts/browser';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { readServerTableActionControlClassName, ServerTableActions } from '../../components/server-table';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ChevronDown } from '../../components/ui/icons';
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
      <DropdownMenu>
        <DeploymentHistoryActionsTrigger />
        <DropdownMenuContent align="end">
          <DeploymentHistoryDetailsAction data={data} onNavigate={onNavigate} run={run} />
          <DeploymentRunRollbackMenuItem data={data} onRollback={onRollback} run={run} />
        </DropdownMenuContent>
      </DropdownMenu>
    </ServerTableActions>
  );
}

function DeploymentHistoryActionsTrigger(): JSX.Element {
  return (
    <DropdownMenuTrigger asChild>
      <Button className={readServerTableActionControlClassName()} size="sm" type="button" variant="secondary">
        Actions
        <ChevronDown className="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
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
