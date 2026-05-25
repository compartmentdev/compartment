import { test, type ConsoleFixtures } from '../fixtures/console-test';

test.describe('console projects real app', (): void => {
  test('logs in, searches, and opens project overview through the deployed console', async ({
    e2eDeployment,
    loginPage,
    projectsPage,
  }: ConsoleFixtures): Promise<void> => {
    const projectName: string = e2eDeployment.projectName;
    const serviceName: string = e2eDeployment.serviceName;
    const noMatchSearchQuery: string = `compartment-e2e-no-match-${e2eDeployment.deploymentRunId}`;

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();
    await projectsPage.expectProjectVisible(projectName);

    await projectsPage.search(noMatchSearchQuery);

    await projectsPage.expectSearchQuery(noMatchSearchQuery);
    await projectsPage.expectReady();
    await projectsPage.expectNoProjectsFound();

    await projectsPage.search(projectName);

    await projectsPage.expectSearchQuery(projectName);
    await projectsPage.expectReady();
    await projectsPage.expectProjectVisible(projectName);

    await projectsPage.openProjectOverview(projectName);

    await projectsPage.expectProjectOverviewVisible(projectName);
    await projectsPage.expectProjectServiceVisible(serviceName);
  });
});
