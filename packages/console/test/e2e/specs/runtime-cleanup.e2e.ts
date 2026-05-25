import { execFile, type ExecFileException } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import {
  buildCompartmentProjectApiPathname,
  buildCompartmentProjectArchiveApiPathname,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts/browser';
import { LoginPage } from '../pages/login-page';
import { test, type ConsoleFixtures } from '../fixtures/console-test';
import { readConsoleE2eAdminAccount } from '../support/console-e2e-account';
import type { ConsoleE2eCleanupProjectFixture } from '../support/console-e2e-fixture';

interface BrowserProjectMutationInput {
  csrfCookieName: string;
  csrfHeaderName: string;
  method: string;
  organizationHeaderName: string;
  organizationSlug: string;
  path: string;
}

interface BrowserProjectMutationResult {
  body: string | null;
  networkError: string | null;
  status: number | null;
}

interface ProjectMutationPayload {
  project: {
    id: string;
    name: string;
  };
}

interface ProjectMutationErrorPayload {
  error?: {
    code?: string;
  };
}

interface RuntimeCleanupFixtures extends ConsoleFixtures {
  page: Page;
}

const dockerCleanupPollTimeoutMs: number = 15_000;
const dockerProjectIdLabelName: string = 'compartment.projectId';
const projectDeleteMutationPollTimeoutMs: number = 30_000;

test.describe('console project runtime cleanup', (): void => {
  test('archives and deletes an isolated project without leaking Docker runtime resources', async ({
    e2eCleanupProject,
    page,
    projectsPage,
  }: RuntimeCleanupFixtures): Promise<void> => {
    const loginPage: LoginPage = new LoginPage(page, readConsoleE2eAdminAccount());

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();
    await expectDockerProjectRuntimePresent(e2eCleanupProject);
    const projectId: string = await readDockerProjectId(e2eCleanupProject);

    const archiveBody: string | null = await runProjectMutation(
      page,
      'POST',
      buildCompartmentProjectArchiveApiPathname(e2eCleanupProject.projectName),
    );
    if (archiveBody !== null) {
      expect(parseProjectMutationPayload(archiveBody).project.name).toBe(e2eCleanupProject.projectName);
    }
    await expectDockerProjectContainersAbsent(e2eCleanupProject);
    await expectDockerProjectVolumesPresent(e2eCleanupProject);

    await runProjectDeleteMutation(page, buildCompartmentProjectApiPathname(e2eCleanupProject.projectName));
    await expectNoDockerProjectRuntimeResources({
      ...e2eCleanupProject,
      projectId,
    });
  });
});

async function runProjectMutation(page: Page, method: string, path: string): Promise<string | null> {
  const result: BrowserProjectMutationResult = await executeProjectMutation(page, method, path);

  if (result.networkError !== null) {
    expect(result.networkError).toBe('Failed to fetch');
    return null;
  }
  expect(result.status, result.body ?? '').toBe(200);
  return result.body;
}

async function executeProjectMutation(page: Page, method: string, path: string): Promise<BrowserProjectMutationResult> {
  return await page.evaluate(
    async (input: BrowserProjectMutationInput): Promise<BrowserProjectMutationResult> => {
      function readCookie(name: string): string | undefined {
        const prefix: string = `${name}=`;
        const match: string | undefined = document.cookie
          .split('; ')
          .find((cookie: string): boolean => cookie.startsWith(prefix));

        return match === undefined ? undefined : decodeURIComponent(match.slice(prefix.length));
      }

      const csrfToken: string | undefined = readCookie(input.csrfCookieName);
      if (csrfToken === undefined) {
        throw new Error('Expected browser project mutation to have a CSRF cookie.');
      }

      try {
        const response: Response = await fetch(input.path, {
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            [input.csrfHeaderName]: csrfToken,
            [input.organizationHeaderName]: input.organizationSlug,
          },
          method: input.method,
        });

        return {
          body: await response.text(),
          networkError: null,
          status: response.status,
        };
      } catch (error) {
        return {
          body: null,
          networkError: error instanceof Error ? error.message : 'Unknown browser fetch error.',
          status: null,
        };
      }
    },
    {
      csrfCookieName: compartmentCsrfCookieName,
      csrfHeaderName: compartmentCsrfHeaderName,
      method,
      organizationHeaderName: compartmentCurrentOrganizationHeaderName,
      organizationSlug: readCurrentOrganizationSlug(page.url()),
      path,
    },
  );
}

async function runProjectDeleteMutation(page: Page, path: string): Promise<void> {
  await expect
    .poll(async (): Promise<string> => await runProjectDeleteMutationAttempt(page, path), {
      timeout: projectDeleteMutationPollTimeoutMs,
    })
    .toBe('deleted');
}

async function runProjectDeleteMutationAttempt(page: Page, path: string): Promise<string> {
  const result: BrowserProjectMutationResult = await executeProjectMutation(page, 'DELETE', path);
  if (result.networkError !== null) {
    expect(result.networkError).toBe('Failed to fetch');
    return 'deleted';
  }
  if (result.status === 200) {
    return 'deleted';
  }
  if (isProjectDeleteBlockedResult(result)) {
    return 'blocked';
  }

  throw new Error(result.body ?? `Unexpected project delete status: ${result.status ?? 'unknown'}`);
}

function isProjectDeleteBlockedResult(result: BrowserProjectMutationResult): boolean {
  if (result.status !== 409 || result.body === null) {
    return false;
  }
  const payload: ProjectMutationErrorPayload = JSON.parse(result.body) as ProjectMutationErrorPayload;
  return payload.error?.code === 'project_delete_blocked';
}

function parseProjectMutationPayload(body: string): ProjectMutationPayload {
  return JSON.parse(body) as ProjectMutationPayload;
}

async function expectDockerProjectRuntimePresent(project: ConsoleE2eCleanupProjectFixture): Promise<void> {
  expect(await listDockerProjectContainers(project)).not.toEqual([]);
  expect(await listDockerProjectVolumes(project)).not.toEqual([]);
}

async function expectDockerProjectVolumesPresent(project: ConsoleE2eCleanupProjectFixture): Promise<void> {
  expect(await listDockerProjectVolumes(project)).not.toEqual([]);
}

async function expectDockerProjectContainersAbsent(project: ConsoleE2eCleanupProjectFixture): Promise<void> {
  await expect
    .poll(async (): Promise<string[]> => await listDockerProjectContainers(project), {
      timeout: dockerCleanupPollTimeoutMs,
    })
    .toEqual([]);
}

async function expectNoDockerProjectRuntimeResources(
  project: ConsoleE2eCleanupProjectFixture & { projectId: string },
): Promise<void> {
  await expect
    .poll(async (): Promise<string[]> => await listDockerProjectContainers(project), {
      timeout: dockerCleanupPollTimeoutMs,
    })
    .toEqual([]);
  await expect
    .poll(async (): Promise<string[]> => await listDockerProjectVolumes(project), {
      timeout: dockerCleanupPollTimeoutMs,
    })
    .toEqual([]);
  await expect
    .poll(async (): Promise<string[]> => await listDockerProjectRuntimeNetworks(project), {
      timeout: dockerCleanupPollTimeoutMs,
    })
    .toEqual([]);
  await expectNoCaddyProjectNetworkAttachment(project);
}

async function expectNoCaddyProjectNetworkAttachment(
  project: ConsoleE2eCleanupProjectFixture & { projectId: string },
): Promise<void> {
  await expect
    .poll(async (): Promise<string[]> => await listCaddyProjectNetworkAttachments(project), {
      timeout: dockerCleanupPollTimeoutMs,
    })
    .toEqual([]);
}

async function listCaddyProjectNetworkAttachments(
  project: ConsoleE2eCleanupProjectFixture & { projectId: string },
): Promise<string[]> {
  const caddyContainerIds: string[] = await listDockerLines([
    'ps',
    '--filter',
    `label=com.docker.compose.project=${project.dockerNamespace}`,
    '--filter',
    'label=com.docker.compose.service=caddy',
    '--format',
    '{{.ID}}',
  ]);
  expect(caddyContainerIds).toHaveLength(1);

  const networks: Record<string, object> = JSON.parse(
    await runDocker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', caddyContainerIds[0]!]),
  ) as Record<string, object>;

  return Object.keys(networks).filter((name: string): boolean => name.includes(project.projectId));
}

async function listDockerProjectContainers(project: ConsoleE2eCleanupProjectFixture): Promise<string[]> {
  return await listDockerLines([
    'ps',
    '-a',
    '--filter',
    `label=compartment.namespace=${project.dockerNamespace}`,
    '--filter',
    `label=compartment.project=${project.projectName}`,
    '--format',
    '{{.ID}}',
  ]);
}

async function readDockerProjectId(project: ConsoleE2eCleanupProjectFixture): Promise<string> {
  const containerIds: string[] = await listDockerProjectContainers(project);
  expect(containerIds).not.toEqual([]);

  const projectIds: string[] = [
    ...new Set(
      await listDockerLines([
        'inspect',
        '--format',
        `{{ index .Config.Labels "${dockerProjectIdLabelName}" }}`,
        ...containerIds,
      ]),
    ),
  ];
  expect(projectIds).toHaveLength(1);

  return projectIds[0]!;
}

async function listDockerProjectVolumes(project: ConsoleE2eCleanupProjectFixture): Promise<string[]> {
  return await listDockerLines([
    'volume',
    'ls',
    '--filter',
    `label=compartment.namespace=${project.dockerNamespace}`,
    '--filter',
    `label=compartment.project=${project.projectName}`,
    '--format',
    '{{.Name}}',
  ]);
}

async function listDockerRuntimeNetworks(dockerNamespace: string): Promise<string[]> {
  return await listDockerLines([
    'network',
    'ls',
    '--filter',
    `label=compartment.namespace=${dockerNamespace}`,
    '--format',
    '{{.Name}}',
  ]);
}

async function listDockerProjectRuntimeNetworks(
  project: ConsoleE2eCleanupProjectFixture & { projectId: string },
): Promise<string[]> {
  return (await listDockerRuntimeNetworks(project.dockerNamespace)).filter((name: string): boolean =>
    name.includes(project.projectId),
  );
}

async function listDockerLines(args: string[]): Promise<string[]> {
  return (await runDocker(args))
    .split('\n')
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0);
}

async function runDocker(args: string[]): Promise<string> {
  return await new Promise<string>((resolve: (value: string) => void, reject: (reason?: Error) => void): void => {
    execFile(
      'docker',
      args,
      { encoding: 'utf8' },
      (error: ExecFileException | null, stdout: string, stderr: string): void => {
        if (error !== null) {
          reject(new Error(`docker ${args.join(' ')} failed: ${stderr}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function readCurrentOrganizationSlug(currentUrl: string): string {
  const [, prefix, organizationSlug] = new URL(currentUrl).pathname.split('/');
  if (prefix !== 'orgs' || organizationSlug === undefined) {
    throw new Error('Expected project cleanup page URL to include an organization slug.');
  }

  return decodeURIComponent(organizationSlug);
}
