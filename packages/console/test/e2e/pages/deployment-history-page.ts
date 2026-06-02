import {
  buildCompartmentConsoleOrganizationScopedPathname,
  buildCompartmentConsoleProjectDeploymentsPathname,
  buildCompartmentConsoleProjectOverviewPathname,
  buildCompartmentProjectOverviewApiPathname,
  compartmentDeploymentsPathname,
  deploymentListResponseSchema,
  type DeploymentReadSummary,
  type DeploymentListResponse,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { ConsoleE2eDeploymentFixture } from '../support/console-e2e-fixture';
import { isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';

export class DeploymentHistoryPage {
  private deploymentListResponse: DeploymentListResponse | null = null;
  private readonly organizationSlug: string;
  private readonly page: Page;
  private readonly projectDeploymentsLink: Locator;

  constructor(page: Page, organizationSlug: string) {
    this.organizationSlug = organizationSlug;
    this.page = page;
    this.projectDeploymentsLink = page.getByRole('link', { name: /Deployments$/ });
  }

  async openFromProjectOverview(deployment: ConsoleE2eDeploymentFixture): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        this.isProjectOverviewResponse(response, deployment.projectName),
      ),
      this.page.goto(this.buildOrganizationPathname(buildProjectOverviewPathname(deployment))),
    ]);
    await expect(this.projectDeploymentsLink).toBeVisible();

    const [deploymentListResponse] = await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isDeploymentListResponse(response, deployment)),
      this.page.waitForURL((url: URL): boolean => this.isDeploymentHistoryUrl(url, deployment)),
      this.projectDeploymentsLink.click(),
    ]);
    this.deploymentListResponse = deploymentListResponseSchema.parse(await deploymentListResponse.json());

    await expect(this.page.getByRole('heading', { name: 'Deployments' })).toBeVisible();
    await expect(this.page.getByRole('table')).toBeVisible();
  }

  async expectDeploymentVisible(deployment: ConsoleE2eDeploymentFixture): Promise<void> {
    const response: DeploymentListResponse = this.readDeploymentListResponse();
    expect(
      response.deployments.some(
        (candidate: DeploymentReadSummary): boolean =>
          candidate.deploymentRunId === deployment.deploymentRunId && candidate.serviceName === deployment.serviceName,
      ),
    ).toBe(true);

    const row: Locator = this.getDeploymentRunRow(deployment.deploymentRunId);
    await expect(row).toBeVisible();
    await expect(row.getByText(deployment.serviceName, { exact: true })).toBeVisible();
  }

  async openDeploymentDetails(deploymentRunId: string): Promise<void> {
    const row: Locator = this.getDeploymentRunRow(deploymentRunId);
    const detailsLink: Locator = row.getByRole('link', { name: 'Details' });
    await expect(detailsLink).toBeVisible();
    await detailsLink.click();
  }

  private getDeploymentRunRow(deploymentRunId: string): Locator {
    return this.page.getByRole('row').filter({ hasText: deploymentRunId });
  }

  private isDeploymentListResponse(response: Response, deployment: Readonly<ConsoleE2eDeploymentFixture>): boolean {
    if (!isSuccessfulApiResponse(response, compartmentDeploymentsPathname)) {
      return false;
    }

    const responseUrl: URL = new URL(response.url());
    return (
      responseUrl.searchParams.get('environmentName') === deployment.environmentName &&
      responseUrl.searchParams.get('projectName') === deployment.projectName
    );
  }

  private isProjectOverviewResponse(response: Response, projectName: string): boolean {
    return isSuccessfulApiResponse(response, buildCompartmentProjectOverviewApiPathname(projectName));
  }

  private isDeploymentHistoryUrl(url: URL, deployment: Readonly<ConsoleE2eDeploymentFixture>): boolean {
    return (
      isConsolePathname(url, buildCompartmentConsoleProjectDeploymentsPathname(deployment.projectName)) &&
      url.searchParams.get('environmentName') === deployment.environmentName
    );
  }

  private readDeploymentListResponse(): DeploymentListResponse {
    if (this.deploymentListResponse === null) {
      throw new Error('Expected deployment list response before asserting deployment history.');
    }

    return this.deploymentListResponse;
  }

  private buildOrganizationPathname(pathname: string): string {
    return buildCompartmentConsoleOrganizationScopedPathname(this.organizationSlug, pathname);
  }
}

function buildProjectOverviewPathname(deployment: Readonly<ConsoleE2eDeploymentFixture>): string {
  const searchParams: URLSearchParams = new URLSearchParams({
    environmentName: deployment.environmentName,
  });
  return `${buildCompartmentConsoleProjectOverviewPathname(deployment.projectName)}?${searchParams.toString()}`;
}
