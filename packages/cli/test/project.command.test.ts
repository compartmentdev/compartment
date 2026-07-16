import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createErrorResponse,
  projectDeleteResponseSchema,
  projectShowResponseSchema,
  projectResponseSchema,
  type ProjectDeleteResponse,
  type ProjectLifecycleAction,
  type ProjectLifecycleResponse,
  type ProjectLifecycleState,
  type ProjectShowResponse,
  type ProjectResponse,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

describe.sequential('compartment project commands', (): void => {
  let configDirectory: string;
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-project-'));
    configDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-config-'));
    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    await writeCliConfig(configDirectory);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    vi.unstubAllGlobals();
    await rm(tempRoot, { force: true, recursive: true });
    await rm(configDirectory, { force: true, recursive: true });
  });

  it('shows a repo-linked project as not_created before the first deploy', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createErrorResponse('project_not_found', 'The requested project was not found.')), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 404,
        }),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliJsonResult<ProjectShowResponse> = await runCliJson(
      ['project', 'show', '--output', 'json'],
      projectShowResponseSchema,
    );

    expectCliSuccess(result);
    const payload: ProjectShowResponse = result.payload;
    expect(payload.localProjectName).toBe('smoke-web');
    expect(payload.project).toBeNull();
    expect(payload.remoteState).toBe('not_created');
  });

  it('deletes a remote project in json mode without changing compartment.yml', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const descriptorPath: string = join(projectDirectory, 'compartment.yml');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            projectName: 'smoke-web',
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliJsonResult<ProjectDeleteResponse> = await runCliJson(
      ['project', 'delete', '--project', 'smoke-web', '--yes', '--output', 'json'],
      projectDeleteResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.projectName).toBe('smoke-web');
    expect(await readFile(descriptorPath, 'utf8')).toBe('name: smoke-web\n\nservices:\n  web: .\n');
  });

  it('deletes a remote project in text mode', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            projectName: 'smoke-web',
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'delete', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toBe('Deleted project smoke-web.\n');
  });

  it('stops a project in text mode', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createProjectLifecycleResponse('stop', 'stopped')), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        }),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'stop', '--project', 'smoke-web'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toBe('Stopped project smoke-web in production.\n');
  });

  it('surfaces project stop transport failures without retrying the mutation', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockRejectedValueOnce(new Error('socket closed'));
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand(
      ['project', 'stop', '--project', 'smoke-web'],
      createCliCapture(),
    );

    expectCliFailure(result, 'POST /v1/projects/smoke-web/stop failed: network request failed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('archives a remote project in text mode when --yes is provided', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            project: {
              archivedAt: '2026-03-24T01:00:00.000Z',
              createdAt: '2026-03-24T00:00:00.000Z',
              id: 'prj_123',
              name: 'smoke-web',
              organizationId: 'org_123',
              updatedAt: '2026-03-24T01:00:00.000Z',
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'archive', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toBe('Archived project smoke-web.\n');
  });

  it('surfaces project archive transport failures without retrying the mutation', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockRejectedValueOnce(new Error('socket closed'));
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand(
      ['project', 'archive', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliFailure(result, 'POST /v1/projects/smoke-web/archive failed: network request failed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lists one project page and points to the next page when more rows exist', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL): Promise<Response> => {
        await Promise.resolve();
        const url: URL = new URL(String(input));

        return new Response(
          JSON.stringify({
            detail: 'overview',
            pagination: {
              page: Number(url.searchParams.get('page') ?? '1'),
              perPage: 100,
              totalItems: 101,
              totalPages: 2,
            },
            projects: [
              {
                archivedAt: null,
                canManageArchive: true,
                canReadDeployments: true,
                canManageLifecycle: true,
                createdAt: '2026-03-24T00:00:00.000Z',
                environmentName: 'production',
                id: 'prj_123',
                lastDeploymentCreatedAt: '2026-03-24T01:00:00.000Z',
                lifecycleAction: 'stop',
                lifecycleDisabledReason: null,
                lifecycleState: 'running',
                name: 'smoke-web',
                openTargets: [
                  {
                    environmentName: 'production',
                    routeUrl: 'https://smoke-web.example.com',
                    serviceName: 'web',
                  },
                ],
                organizationId: 'org_123',
                routeUrl: 'https://smoke-web.example.com',
                serviceCount: 2,
                status: 'healthy',
                updatedAt: '2026-03-24T01:00:00.000Z',
              },
            ],
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        );
      });
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand(['project', 'list', '--all', '--full'], createCliCapture());

    expectCliSuccess(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/v1/projects?archiveState=all&detail=overview&page=1&perPage=100',
    );
    expect(readCliStdout(result.capture)).toBe(`smoke-web\thealthy\t2 services\thttps://smoke-web.example.com
Showing projects 1-100 of 101. Use --page 2 to view more.
`);
  });

  it('renames the linked remote project and updates compartment.yml', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const descriptorPath: string = join(projectDirectory, 'compartment.yml');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            project: {
              archivedAt: null,
              createdAt: '2026-03-24T00:00:00.000Z',
              id: 'prj_123',
              name: 'renamed-web',
              organizationId: 'org_123',
              updatedAt: '2026-03-24T00:00:00.000Z',
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        ),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliJsonResult<ProjectResponse> = await runCliJson(
      ['project', 'rename', 'renamed-web', '--output', 'json'],
      projectResponseSchema,
    );

    expectCliSuccess(result);
    const payload: ProjectResponse = result.payload;
    expect(payload.project.name).toBe('renamed-web');
    expect(await readFile(descriptorPath, 'utf8')).toBe('name: renamed-web\n\nservices:\n  web: .\n');
  });

  it('rejects renaming a linked project before the remote mutation when compartment.yml is a symlink', async (): Promise<void> => {
    const projectDirectory: string = join(tempRoot, 'repo');
    const outsideDirectory: string = join(tempRoot, 'outside');
    const outsideDescriptorPath: string = join(outsideDirectory, 'compartment.yml');
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          project: {
            archivedAt: null,
            createdAt: '2026-03-24T00:00:00.000Z',
            id: 'prj_123',
            name: 'renamed-web',
            organizationId: 'org_123',
            updatedAt: '2026-03-24T00:00:00.000Z',
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    );

    await mkdir(projectDirectory);
    await mkdir(outsideDirectory);
    await writeFile(join(projectDirectory, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await writeFile(outsideDescriptorPath, 'name: smoke-web\n\nservices:\n  web: .\n', 'utf8');
    await symlink(outsideDescriptorPath, join(projectDirectory, 'compartment.yml'));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['project', 'rename', 'renamed-web'], createCliCapture());

    expectCliFailure(result, 'must not include symlinks');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readFile(outsideDescriptorPath, 'utf8')).resolves.toBe('name: smoke-web\n\nservices:\n  web: .\n');
  });

  it('rejects showing an archived project', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createErrorResponse('project_archived', 'The requested project is archived.')), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 409,
        }),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['project', 'show', '--output', 'json'], createCliCapture());

    expectCliFailure(result, 'The requested project is archived.');
  });

  it('requires an explicit project slug for project delete even inside a repo', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');

    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['project', 'delete', '--yes'], createCliCapture());

    expectCliFailure(result, 'Project delete requires --project <slug>.');
  });

  it('shows the first-login guidance for project list', async (): Promise<void> => {
    await writeCliConfig(configDirectory, {});

    const result: CliCommandResult = await runCliCommand(['project', 'list'], createCliCapture());

    expectCliFailure(result, 'No Compartment login is configured. Run `compartment login --api-url <url>` first.');
    expect(readCliStdout(result.capture)).toBe('');
  });

  it('requires explicit destructive confirmation for project delete', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(
      ['project', 'delete', '--project', 'smoke-web'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Project delete requires --yes.');
  });

  it('requires explicit destructive confirmation for project archive', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(
      ['project', 'archive', '--project', 'smoke-web'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Project archive requires --yes.');
  });

  it('surfaces project delete not found errors', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createErrorResponse('project_not_found', 'The requested project was not found.')), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 404,
        }),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'delete', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliFailure(result, 'The requested project was not found.');
  });

  it('surfaces archive-first delete errors', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createErrorResponse('project_delete_requires_archive', 'Archive the project before deleting it.'),
          ),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 409,
          },
        ),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'delete', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Archive the project before deleting it.');
  });

  it('surfaces blocked delete errors', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createErrorResponse(
              'project_delete_blocked',
              'The project cannot be deleted while deployments are active, queued, or running.',
            ),
          ),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 409,
          },
        ),
      ),
    );

    const result: CliCommandResult = await runCliCommand(
      ['project', 'delete', '--project', 'smoke-web', '--yes'],
      createCliCapture(),
    );

    expectCliFailure(result, 'The project cannot be deleted while deployments are active, queued, or running.');
  });
});

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function writeCliConfig(configDirectory: string, config: object = createCliConfigFixture()): Promise<void> {
  await writeFile(join(configDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function createProjectDirectory(tempRoot: string, projectName: string): Promise<string> {
  const projectDirectory: string = join(tempRoot, projectName);
  await mkdir(projectDirectory);
  await writeFile(join(projectDirectory, 'compartment.yml'), `name: ${projectName}\n\nservices:\n  web: .\n`, 'utf8');
  return projectDirectory;
}

function createProjectLifecycleResponse(
  action: ProjectLifecycleAction,
  state: ProjectLifecycleState,
): ProjectLifecycleResponse {
  return {
    action,
    deployments: [],
    environment: {
      createdAt: '2026-03-24T00:00:00.000Z',
      id: 'env_123',
      name: action === 'start' ? 'staging' : 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-24T00:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-24T00:00:00.000Z',
      id: 'prj_123',
      name: 'smoke-web',
      organizationId: 'org_123',
      updatedAt: '2026-03-24T00:00:00.000Z',
    },
    state,
  };
}
