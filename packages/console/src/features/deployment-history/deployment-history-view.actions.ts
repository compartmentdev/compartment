import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import type { DeploymentHistoryRollbackHandler } from './deployment-history-actions';
import type { DeployResponse } from '@compartment/contracts/browser';
import { buildDeploymentDetailsHref } from './deployment-history-query';

type DeploymentHistoryActionErrorSetter = (value: string | undefined) => void;

export function createDeploymentHistoryRollbackHandler(
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  setActionErrorMessage: DeploymentHistoryActionErrorSetter,
): DeploymentHistoryRollbackHandler {
  return (deployResponse?: DeployResponse, error?: Error): void => {
    if (error !== undefined) {
      setActionErrorMessage(error.message);
      return;
    }
    const detailsHref: string | null = readRollbackDetailsHref(data, deployResponse);
    if (detailsHref === null) {
      return;
    }

    setActionErrorMessage(undefined);
    onNavigate(detailsHref);
  };
}

function readRollbackDetailsHref(
  data: BrowserDeploymentHistoryPageResult,
  deployResponse: DeployResponse | undefined,
): string | null {
  if (deployResponse === undefined || data.selectedOrganizationSlug === null || data.environmentName === null) {
    return null;
  }

  return buildDeploymentDetailsHref(
    {
      environmentName: data.environmentName,
      organizationSlug: data.selectedOrganizationSlug,
      projectName: data.projectName,
    },
    deployResponse.deploymentRunId,
  );
}
