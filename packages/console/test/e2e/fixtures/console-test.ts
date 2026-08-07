import {
  test as base,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
  type TestType,
} from '@playwright/test';
import { AuditEventsPage } from '../pages/audit-events-page';
import { DeploymentDetailsPage } from '../pages/deployment-details-page';
import { DeploymentHistoryPage } from '../pages/deployment-history-page';
import { EdgeRoutePage } from '../pages/edge-route-page';
import { GroupsPage } from '../pages/groups-page';
import { LoginPage } from '../pages/login-page';
import { ProjectsPage } from '../pages/projects-page';
import { RolesPage } from '../pages/roles-page';
import { UsersPage } from '../pages/users-page';
import { readConsoleE2eAccount } from '../support/console-e2e-account';
import {
  buildConsoleE2eAccessFixture,
  readConsoleE2eFixture,
  type ConsoleE2eAccessFixture,
  type ConsoleE2eDeploymentFixture,
  type ConsoleE2eFixture,
  type ConsoleE2eProxyRouteFixture,
} from '../support/console-e2e-fixture';

export interface ConsoleFixtures {
  auditEventsPage: AuditEventsPage;
  deploymentDetailsPage: DeploymentDetailsPage;
  deploymentHistoryPage: DeploymentHistoryPage;
  edgeRoutePage: EdgeRoutePage;
  e2eAccess: ConsoleE2eAccessFixture;
  e2eDeployment: ConsoleE2eDeploymentFixture;
  e2eProxyRoute: ConsoleE2eProxyRouteFixture;
  groupsPage: GroupsPage;
  loginPage: LoginPage;
  projectsPage: ProjectsPage;
  rolesPage: RolesPage;
  usersPage: UsersPage;
}

interface PageFixtureArgs {
  page: Page;
}

interface BrowserNameFixtureArgs {
  browserName: string;
}

type FixtureUse<TValue> = (value: TValue) => Promise<void>;

interface ConsoleE2eFixtureArgs {
  consoleE2eFixture: ConsoleE2eFixture;
}

interface ConsoleWorkerFixtures {
  consoleE2eFixture: ConsoleE2eFixture;
}

type ConsoleTestArgs = PlaywrightTestArgs & PlaywrightTestOptions & ConsoleFixtures;
type ConsoleWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions & ConsoleWorkerFixtures;

export const test: TestType<ConsoleTestArgs, ConsoleWorkerArgs> = base.extend<ConsoleFixtures, ConsoleWorkerFixtures>({
  auditEventsPage: async ({ page }: PageFixtureArgs, use: FixtureUse<AuditEventsPage>): Promise<void> => {
    await use(new AuditEventsPage(page));
  },
  deploymentDetailsPage: async ({ page }: PageFixtureArgs, use: FixtureUse<DeploymentDetailsPage>): Promise<void> => {
    await use(new DeploymentDetailsPage(page));
  },
  deploymentHistoryPage: async (
    { consoleE2eFixture, page }: ConsoleE2eFixtureArgs & PageFixtureArgs,
    use: FixtureUse<DeploymentHistoryPage>,
  ): Promise<void> => {
    await use(new DeploymentHistoryPage(page, consoleE2eFixture.organizationSlug));
  },
  edgeRoutePage: async ({ page }: PageFixtureArgs, use: FixtureUse<EdgeRoutePage>): Promise<void> => {
    await use(new EdgeRoutePage(page));
  },
  e2eAccess: async (
    { consoleE2eFixture }: ConsoleE2eFixtureArgs,
    use: FixtureUse<ConsoleE2eAccessFixture>,
    testInfo: TestInfo,
  ): Promise<void> => {
    await use(
      buildConsoleE2eAccessFixture(consoleE2eFixture.deployment.deploymentRunId, readConsoleE2eAttemptId(testInfo)),
    );
  },
  e2eDeployment: async (
    { consoleE2eFixture }: ConsoleE2eFixtureArgs,
    use: FixtureUse<ConsoleE2eDeploymentFixture>,
  ): Promise<void> => {
    await use(consoleE2eFixture.deployment);
  },
  e2eProxyRoute: async (
    { consoleE2eFixture }: ConsoleE2eFixtureArgs,
    use: FixtureUse<ConsoleE2eProxyRouteFixture>,
  ): Promise<void> => {
    await use(consoleE2eFixture.proxyRoute);
  },
  groupsPage: async (
    { consoleE2eFixture, page }: ConsoleE2eFixtureArgs & PageFixtureArgs,
    use: FixtureUse<GroupsPage>,
  ): Promise<void> => {
    await use(new GroupsPage(page, consoleE2eFixture.organizationSlug));
  },
  loginPage: async ({ page }: PageFixtureArgs, use: FixtureUse<LoginPage>): Promise<void> => {
    await use(new LoginPage(page, readConsoleE2eAccount()));
  },
  projectsPage: async ({ page }: PageFixtureArgs, use: FixtureUse<ProjectsPage>): Promise<void> => {
    await use(new ProjectsPage(page));
  },
  rolesPage: async (
    { consoleE2eFixture, page }: ConsoleE2eFixtureArgs & PageFixtureArgs,
    use: FixtureUse<RolesPage>,
  ): Promise<void> => {
    await use(new RolesPage(page, consoleE2eFixture.organizationSlug));
  },
  usersPage: async (
    { consoleE2eFixture, page }: ConsoleE2eFixtureArgs & PageFixtureArgs,
    use: FixtureUse<UsersPage>,
  ): Promise<void> => {
    await use(new UsersPage(page, consoleE2eFixture.organizationSlug));
  },
  consoleE2eFixture: [
    async ({ browserName }: BrowserNameFixtureArgs, use: FixtureUse<ConsoleE2eFixture>): Promise<void> => {
      void browserName;
      await use(readConsoleE2eFixture());
    },
    { scope: 'worker' },
  ],
});

function readConsoleE2eAttemptId(testInfo: TestInfo): string {
  return `worker-${testInfo.workerIndex}-retry-${testInfo.retry}`;
}
