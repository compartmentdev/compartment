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

  async openFromProjectOverview(projectName: string): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isProjectOverviewResponse(response, projectName)),
      this.page.goto(this.buildOrganizationPathname(buildCompartmentConsoleProjectOverviewPathname(projectName))),
    ]);
    await expect(this.projectDeploymentsLink).toBeVisible();

    const [deploymentListResponse] = await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isDeploymentListResponse(response, projectName)),
      this.page.waitForURL((url: URL): boolean =>
        isConsolePathname(url, buildCompartmentConsoleProjectDeploymentsPathname(projectName)),
      ),
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
    await row.getByRole('link', { name: 'Details' }).click();
  }

  private getDeploymentRunRow(deploymentRunId: string): Locator {
    return this.page.getByRole('row').filter({ hasText: deploymentRunId });
  }

  private isDeploymentListResponse(response: Response, projectName: string): boolean {
    if (!isSuccessfulApiResponse(response, compartmentDeploymentsPathname)) {
      return false;
    }

    const responseUrl: URL = new URL(response.url());
    return responseUrl.searchParams.get('projectName') === projectName;
  }

  private isProjectOverviewResponse(response: Response, projectName: string): boolean {
    return isSuccessfulApiResponse(response, buildCompartmentProjectOverviewApiPathname(projectName));
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
