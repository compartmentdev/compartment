import {
  buildBrowserProjectDeploymentDetailsPathname,
  buildBrowserProjectDeploymentsPathname,
} from '../../browser-public-paths';
import { appendBrowserProjectHrefSearch } from '../projects/project-href-query';
import { deploymentDetailsUnavailableErrorCode } from './deployment-history-error';

interface BrowserDeploymentHistoryHrefInput {
  environmentName: string | null;
  organizationSlug: string | null;
  projectName: string;
}

export function buildDeploymentHistoryUnavailableHref(input: Readonly<BrowserDeploymentHistoryHrefInput>): string {
  return appendSearchParam(buildDeploymentHistoryHref(input), 'error', deploymentDetailsUnavailableErrorCode);
}

export function buildDeploymentHistoryHref(input: Readonly<BrowserDeploymentHistoryHrefInput>): string {
  return appendBrowserProjectHrefSearch(buildBrowserProjectDeploymentsPathname(input.projectName), input);
}

export function buildDeploymentDetailsHref(
  input: Readonly<BrowserDeploymentHistoryHrefInput>,
  deploymentRunId: string,
): string {
  const pathname: string = buildBrowserProjectDeploymentDetailsPathname(input.projectName, deploymentRunId);
  return appendBrowserProjectHrefSearch(pathname, input);
}

function appendSearchParam(href: string, key: string, value: string): string {
  const separator: string = href.includes('?') ? '&' : '?';
  return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
