import type { DeploymentRunLogsResponse } from '@compartment/contracts/browser';
import { test, type ConsoleFixtures } from '../fixtures/console-test';

test.describe('console deployments real app', (): void => {
  test('opens deployment history and deployment run logs through the deployed console', async ({
    deploymentDetailsPage,
    deploymentHistoryPage,
    e2eDeployment,
    loginPage,
    projectsPage,
  }: ConsoleFixtures): Promise<void> => {
    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();

    await deploymentHistoryPage.openFromProjectOverview(e2eDeployment.projectName);
    await deploymentHistoryPage.expectDeploymentVisible(e2eDeployment);

    const runLogsResponsePromise: Promise<DeploymentRunLogsResponse> = deploymentDetailsPage.waitForRunLogsResponse(
      e2eDeployment.projectName,
      e2eDeployment.deploymentRunId,
    );
    await deploymentHistoryPage.openDeploymentDetails(e2eDeployment.deploymentRunId);
    await deploymentDetailsPage.expectDeploymentRunVisible(e2eDeployment, await runLogsResponsePromise);
  });
});
