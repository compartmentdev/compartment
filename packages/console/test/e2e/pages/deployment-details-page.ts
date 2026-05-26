import {
  buildCompartmentConsoleProjectDeploymentDetailsPathname,
  compartmentDeploymentRunLogsPathname,
  deploymentRunLogsResponseSchema,
  type DeploymentReadSummary,
  type DeploymentRunLogLine,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import {
  deploymentRunStepStatusLabels,
  deploymentStatusLabels,
} from '@/features/deployment-history/deployment-history-labels';
import type { ConsoleE2eDeploymentFixture } from '../support/console-e2e-fixture';
import { isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';

export class DeploymentDetailsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForRunLogsResponse(projectName: string, deploymentRunId: string): Promise<DeploymentRunLogsResponse> {
    const response: Response = await this.page.waitForResponse((candidate: Response): boolean =>
      this.isDeploymentRunLogsResponse(candidate, projectName, deploymentRunId),
    );
    return deploymentRunLogsResponseSchema.parse(await response.json());
  }

  async expectDeploymentRunVisible(
    deployment: ConsoleE2eDeploymentFixture,
    response: DeploymentRunLogsResponse,
  ): Promise<void> {
    this.expectResponseContainsDeployment(deployment, response);

    await expect(this.page).toHaveURL((url: URL): boolean =>
      isConsolePathname(
        url,
        buildCompartmentConsoleProjectDeploymentDetailsPathname(deployment.projectName, deployment.deploymentRunId),
      ),
    );
    await expect(this.page.getByRole('heading', { name: 'Deployment run details' })).toBeVisible();
    await expect(this.page.getByText(deployment.deploymentRunId, { exact: true })).toBeVisible();
    await expect(
      this.page.getByText(deploymentStatusLabels[response.deployment.status], { exact: true }).first(),
    ).toBeVisible();

    await this.expectServiceVisible(deployment, response);
    await this.expectStepsVisible(response);
    await this.expectLogsVisible(response);
  }

  private expectResponseContainsDeployment(
    deployment: ConsoleE2eDeploymentFixture,
    response: DeploymentRunLogsResponse,
  ): void {
    expect(response.project.name).toBe(deployment.projectName);
    expect(response.deployment.id).toBe(deployment.deploymentRunId);
    expect(
      response.deployments.some(
        (candidate: DeploymentReadSummary): boolean =>
          candidate.deploymentRunId === deployment.deploymentRunId && candidate.serviceName === deployment.serviceName,
      ),
    ).toBe(true);
  }

  private async expectServiceVisible(
    deployment: ConsoleE2eDeploymentFixture,
    response: DeploymentRunLogsResponse,
  ): Promise<void> {
    const serviceDeployment: DeploymentReadSummary = readDeploymentSummary(response, deployment.serviceName);
    const serviceRow: Locator = this.page.getByRole('row').filter({ hasText: serviceDeployment.id });
    await expect(serviceRow).toBeVisible();
    await expect(serviceRow.getByText(deployment.serviceName, { exact: true })).toBeVisible();
    await expect(serviceRow.getByText(deploymentStatusLabels[serviceDeployment.status], { exact: true })).toBeVisible();
  }

  private async expectStepsVisible(response: DeploymentRunLogsResponse): Promise<void> {
    expect(response.steps.length).toBeGreaterThan(0);
    const step: DeploymentRunStepSummary = response.steps[0]!;

    const timelineSection: Locator = this.page
      .locator('section')
      .filter({
        has: this.page.getByRole('heading', { name: 'Timeline' }),
      })
      .last();
    await expect(timelineSection).toBeVisible();
    await expect(timelineSection.getByText(step.message, { exact: true }).first()).toBeVisible();
    await expect(
      timelineSection.getByText(deploymentRunStepStatusLabels[step.status], { exact: true }).first(),
    ).toBeVisible();
  }

  private async expectLogsVisible(response: DeploymentRunLogsResponse): Promise<void> {
    expect(response.lines.length).toBeGreaterThan(0);
    const line: DeploymentRunLogLine = response.lines[0]!;

    await expect(this.page.getByRole('heading', { name: 'Logs' })).toBeVisible();
    await expect(this.page.getByText(line.message, { exact: false })).toBeVisible();
  }

  private isDeploymentRunLogsResponse(response: Response, projectName: string, deploymentRunId: string): boolean {
    if (!isSuccessfulApiResponse(response, compartmentDeploymentRunLogsPathname)) {
      return false;
    }

    const responseUrl: URL = new URL(response.url());
    return (
      responseUrl.searchParams.get('projectName') === projectName &&
      responseUrl.searchParams.get('selector') === 'run' &&
      responseUrl.searchParams.get('deploymentRunId') === deploymentRunId
    );
  }
}

function readDeploymentSummary(response: DeploymentRunLogsResponse, serviceName: string): DeploymentReadSummary {
  const deployment: DeploymentReadSummary | undefined = response.deployments.find(
    (candidate: DeploymentReadSummary): boolean => candidate.serviceName === serviceName,
  );
  if (deployment === undefined) {
    throw new Error(`Expected deployment for service "${serviceName}".`);
  }

  return deployment;
}
