import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  GitSourceExclusionMutationResponse,
  GitProviderRegistrationRepositoryListResponse,
  GitProviderRegistrationListResponse,
  GitHubProviderBootstrapResponse,
  GitSourceListResponse,
  GitSourceResponse,
  GitSourceSettingsResponse,
  GitSourceSyncTaskResponse,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { LocalGitSourcePlan } from '../src/services/source-git-local.service.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandResult,
} from './cli-test.harness';

interface SourceCommandMocks {
  connectGitSourceMock: Mock<ConnectGitSource>;
  disconnectSourceMock: Mock<DisconnectSource>;
  excludeSourceDescriptorMock: Mock<ExcludeSourceDescriptor>;
  getGitHubSourceBootstrapStatusMock: Mock<GetGitHubSourceBootstrapStatus>;
  getGitSourceSyncTaskMock: Mock<GetGitSourceSyncTask>;
  includeSourceDescriptorMock: Mock<IncludeSourceDescriptor>;
  listGitProviderRepositoriesForSourceMock: Mock<ListGitProviderRepositoriesForSource>;
  listSourcesMock: Mock<ListSources>;
  readCliConfigMock: Mock<ReadCliConfig>;
  readLocalGitSourcePlanMock: Mock<ReadLocalGitSourcePlan>;
  readSourceSettingsMock: Mock<ReadSourceSettings>;
  showSourceMock: Mock<ShowSource>;
  startGitSourceSyncMock: Mock<StartGitSourceSync>;
  startGitHubSourceBootstrapMock: Mock<StartGitHubSourceBootstrap>;
  updateSourceSettingsForSourceMock: Mock<UpdateSourceSettingsForSource>;
}

interface SourceServiceModule {
  connectGitSource: Mock<ConnectGitSource>;
  disconnectSource: Mock<DisconnectSource>;
  excludeSourceDescriptor: Mock<ExcludeSourceDescriptor>;
  getGitHubSourceBootstrapStatus: Mock<GetGitHubSourceBootstrapStatus>;
  getGitSourceSyncTask: Mock<GetGitSourceSyncTask>;
  includeSourceDescriptor: Mock<IncludeSourceDescriptor>;
  listGitProviderRepositoriesForSource: Mock<ListGitProviderRepositoriesForSource>;
  listGitSourceRegistrations: Mock<ListGitSourceRegistrations>;
  listSources: Mock<ListSources>;
  readSourceSettings: Mock<ReadSourceSettings>;
  showSource: Mock<ShowSource>;
  startGitSourceSync: Mock<StartGitSourceSync>;
  startGitHubSourceBootstrap: Mock<StartGitHubSourceBootstrap>;
  updateSourceSettingsForSource: Mock<UpdateSourceSettingsForSource>;
}

interface SourceGitLocalServiceModule {
  readLocalGitSourcePlan: Mock<ReadLocalGitSourcePlan>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type ConnectGitSource = (
  context: AuthenticatedContext,
  request: {
    autoAdoptNewApps: boolean;
    defaultAutoDeployEnabled: boolean;
    defaultEnvironmentName: string;
    providerHost: string;
    repositoryName: string;
    repositoryOwner: string;
    syncBranchName: string;
  },
) => Promise<GitSourceResponse>;
type StartGitSourceSync = (context: AuthenticatedContext, sourceId: string) => Promise<GitSourceSyncTaskResponse>;
type GetGitSourceSyncTask = (
  context: AuthenticatedContext,
  sourceId: string,
  taskId: string,
) => Promise<GitSourceSyncTaskResponse>;
type GetGitHubSourceBootstrapStatus = (
  context: AuthenticatedContext,
  bootstrapStateId: string,
) => Promise<GitHubProviderBootstrapResponse>;
type ReadSourceSettings = (context: AuthenticatedContext, sourceId: string) => Promise<GitSourceSettingsResponse>;
type ListSources = (context: AuthenticatedContext) => Promise<GitSourceListResponse>;
type DisconnectSource = (
  context: AuthenticatedContext,
  sourceId: string,
) => Promise<{
  sourceId: string;
  success: true;
}>;
type ExcludeSourceDescriptor = (
  context: AuthenticatedContext,
  sourceId: string,
  descriptorPath: string,
) => Promise<GitSourceExclusionMutationResponse>;
type IncludeSourceDescriptor = (
  context: AuthenticatedContext,
  sourceId: string,
  descriptorPath: string,
) => Promise<GitSourceSyncTaskResponse>;
type ListGitProviderRepositoriesForSource = (
  context: AuthenticatedContext,
  registrationId: string,
) => Promise<GitProviderRegistrationRepositoryListResponse>;
type ListGitSourceRegistrations = (context: AuthenticatedContext) => Promise<GitProviderRegistrationListResponse>;
type UpdateSourceSettingsForSource = (
  context: AuthenticatedContext,
  sourceId: string,
  input: { autoAdoptNewApps: boolean },
) => Promise<GitSourceSettingsResponse>;
type ReadCliConfig = () => Promise<CliConfig>;
type ReadLocalGitSourcePlan = (cwd: string) => Promise<LocalGitSourcePlan>;
type ShowSource = (context: AuthenticatedContext, sourceId: string) => Promise<GitSourceResponse>;
type StartGitHubSourceBootstrap = (
  context: AuthenticatedContext,
  providerHost: string,
  repositoryOwner: string,
) => Promise<GitHubProviderBootstrapResponse>;
type RestoreCliModulePath =
  | '../src/services/source-git-local.service'
  | '../src/services/sources.service'
  | '../src/store/config.store';

const originalNoColor: string | undefined = process.env.NO_COLOR;

describe.sequential('source commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    const modulePaths: RestoreCliModulePath[] = [
      '../src/services/source-git-local.service',
      '../src/services/sources.service',
      '../src/store/config.store',
    ];
    restoreCliCommandModules(modulePaths);
    vi.doUnmock('node:timers/promises');
    restoreNoColorEnv();
  });

  it('lists connected sources in text mode', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.listSourcesMock.mockResolvedValue({
      sources: [
        {
          defaultBranchName: 'main',
          displayName: 'acme/mono',
          id: 'src_123',
          providerHost: 'github.com',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          status: 'active',
        },
      ],
    });

    const result: CliCommandResult = await runCliCommand(['source', 'list'], createCliCapture());

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toBe('src_123\tacme/mono\tmain\tactive\n');
  });

  it('connects a git source with source-level defaults only', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValue(createBootstrapResponseFixture());
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValue(createRepositoryListResponseFixture());
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'source',
        'connect',
        'git',
        '--branch',
        'main',
        '--env',
        'production',
        '--auto-adopt-new-apps',
        'enabled',
        '--auto-deploy',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain(
      'Bootstrap discovery, auto-adopt, and initial deploy started on branch main.',
    );
    expect(mocks.startGitHubSourceBootstrapMock).toHaveBeenCalledWith(expect.any(Object), 'github.com', 'acme');
    expect(mocks.listGitProviderRepositoriesForSourceMock).toHaveBeenCalledWith(expect.any(Object), 'gpr_123');
    expect(mocks.connectGitSourceMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        autoAdoptNewApps: true,
        providerHost: 'github.com',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
      }),
    );
  });

  it('prints a bold GitHub bootstrap link prompt in terminal output', async (): Promise<void> => {
    vi.doMock('node:timers/promises', (): { setTimeout: () => Promise<void> } => ({
      setTimeout: async (): Promise<void> => {
        await Promise.resolve();
      },
    }));
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValue(createPendingBootstrapResponseFixture());
    mocks.getGitHubSourceBootstrapStatusMock.mockResolvedValue(createBootstrapResponseFixture());
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValue(createRepositoryListResponseFixture());
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    delete process.env.NO_COLOR;
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'source',
        'connect',
        'git',
        '--branch',
        'main',
        '--env',
        'production',
        '--auto-adopt-new-apps',
        'enabled',
        '--auto-deploy',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStderr(result.capture)).toContain(
      '\u001B[1mOpen this URL in a browser to continue GitHub App setup:\u001B[22m\nhttps://github.com/apps/compartment-acme/installations/new?state=gbs_123',
    );
    expect(mocks.getGitHubSourceBootstrapStatusMock).toHaveBeenCalledWith(expect.any(Object), 'gbs_123');
  });

  it('does not infer provider bootstrap state from an empty neutral repository listing', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValueOnce(createBootstrapResponseFixture()).mockResolvedValueOnce({
      ...createBootstrapResponseFixture(),
      registrationId: 'gpr_recovered',
    });
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValueOnce({ repositories: [] });
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'source',
        'connect',
        'git',
        '--branch',
        'main',
        '--env',
        'production',
        '--auto-adopt-new-apps',
        'enabled',
        '--auto-deploy',
      ],
      capture,
    );

    expectCliFailure(result, 'GitHub App installation does not include any repositories.');
    expect(mocks.startGitHubSourceBootstrapMock).toHaveBeenCalledOnce();
    expect(mocks.listGitProviderRepositoriesForSourceMock).toHaveBeenCalledWith(expect.any(Object), 'gpr_123');
  });

  it('prompts for owner, repository, branch, environment, and deploy policy when connect flags are omitted', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValue(createBootstrapResponseFixture());
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValue(createRepositoryListResponseFixture());
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\nrelease\nstaging\nn\nn\n');

    const result: CliCommandResult = await runCliCommand(['source', 'connect', 'git'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(result.capture)).toContain('GitHub account or organization [acme]: ');
    expect(readCliStderr(result.capture)).toContain('Available repositories:\n- acme/mono\tdefault branch: main');
    expect(readCliStderr(result.capture)).toContain('Repository [acme/mono]: ');
    expect(readCliStderr(result.capture)).toContain('Branch [main]: ');
    expect(readCliStderr(result.capture)).toContain('Environment [production]: ');
    expect(readCliStderr(result.capture)).toContain('Auto-adopt new apps? [Y/n]: ');
    expect(readCliStderr(result.capture)).toContain('Enable auto deploy? [Y/n]: ');
  });

  it('defaults repository selection to the prompted owner and local repository name', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValue({
      ...createBootstrapResponseFixture(),
      installationAccountLogin: 'other',
      repositoryOwner: 'other',
    });
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValue({
      repositories: [
        {
          defaultBranchName: 'main',
          fullName: 'other/another',
          id: 'repo_another',
          name: 'another',
          owner: 'other',
          private: true,
        },
        {
          defaultBranchName: 'develop',
          fullName: 'other/mono',
          id: 'repo_mono',
          name: 'mono',
          owner: 'other',
          private: true,
        },
      ],
    });
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('other\n\n\n\nn\nn\n');

    const result: CliCommandResult = await runCliCommand(['source', 'connect', 'git'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(result.capture)).toContain('Repository [other/mono]: ');
    expect(readCliStderr(result.capture)).toContain('Branch [develop]: ');
    expect(mocks.connectGitSourceMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        repositoryName: 'mono',
        repositoryOwner: 'other',
        syncBranchName: 'develop',
      }),
    );
  });

  it('uses the verified GitHub installation account login as the repository owner', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readLocalGitSourcePlanMock.mockResolvedValue(createLocalGitSourcePlanFixture());
    mocks.startGitHubSourceBootstrapMock.mockResolvedValue({
      ...createBootstrapResponseFixture(),
      installationAccountLogin: 'acme',
      repositoryOwner: 'ACME',
    });
    mocks.listGitProviderRepositoriesForSourceMock.mockResolvedValue(createRepositoryListResponseFixture());
    mocks.connectGitSourceMock.mockResolvedValue(createGitSourceResponseFixture());
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('ACME\n\n\n\nn\nn\n');

    const result: CliCommandResult = await runCliCommand(['source', 'connect', 'git'], capture);

    expectCliSuccess(result);
    expect(mocks.listGitProviderRepositoriesForSourceMock).toHaveBeenCalledWith(expect.any(Object), 'gpr_123');
    expect(readCliStderr(result.capture)).toContain('Repository [acme/mono]: ');
  });

  it('shows source defaults and latest sync details in text mode', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.showSourceMock.mockResolvedValue(createGitSourceResponseFixture());

    const result: CliCommandResult = await runCliCommand(['source', 'show', 'src_123'], createCliCapture());

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Default environment: production');
    expect(readCliStdout(result.capture)).toContain('Default deploy mode: auto');
    expect(readCliStdout(result.capture)).toContain('Latest sync candidates: accepted=1, blocked=1');
    expect(readCliStdout(result.capture)).toContain(
      '- apps/billing/compartment.yml\tbilling\tProject "billing" already has an active Git binding.',
    );
  });

  it('reads source settings in text mode', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.readSourceSettingsMock.mockResolvedValue(createGitSourceSettingsResponseFixture());

    const result: CliCommandResult = await runCliCommand(['source', 'settings', 'get', 'src_123'], createCliCapture());

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Source settings src_123');
    expect(readCliStdout(result.capture)).toContain('Auto-adopt new apps: disabled');
    expect(readCliStdout(result.capture)).toContain('- apps/billing/compartment.yml');
  });

  it('updates source settings in text mode', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.updateSourceSettingsForSourceMock.mockResolvedValue(createGitSourceSettingsResponseFixture());

    const result: CliCommandResult = await runCliCommand(
      ['source', 'settings', 'set', 'src_123', '--auto-adopt-new-apps', 'disabled'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Auto-adopt new apps: disabled');
  });

  it('excludes a descriptor from source sync', async (): Promise<void> => {
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.excludeSourceDescriptorMock.mockResolvedValue({
      descriptorPath: 'apps/billing/compartment.yml',
      sourceId: 'src_123',
      success: true,
    });

    const result: CliCommandResult = await runCliCommand(
      ['source', 'exclude', 'src_123', 'apps/billing/compartment.yml'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Excluded apps/billing/compartment.yml from source src_123.');
  });

  it('includes a descriptor by waiting for the targeted sync to complete', async (): Promise<void> => {
    vi.doMock('node:timers/promises', (): { setTimeout: () => Promise<void> } => ({
      setTimeout: async (): Promise<void> => {
        await Promise.resolve();
      },
    }));
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.includeSourceDescriptorMock.mockResolvedValueOnce(createPendingGitSourceSyncTaskResponseFixture());
    mocks.getGitSourceSyncTaskMock.mockResolvedValueOnce(createCompletedGitSourceSyncTaskResponseFixture());

    const result: CliCommandResult = await runCliCommand(
      ['source', 'include', 'src_123', 'apps/smoke/compartment.yml'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Completed source sync sst_123 for src_123.');
    expect(readCliStdout(result.capture)).toContain('Accepted apps: 1');
  });

  it('prints accepted and blocked sync candidates without prompting for acceptance', async (): Promise<void> => {
    vi.doMock('node:timers/promises', (): { setTimeout: () => Promise<void> } => ({
      setTimeout: async (): Promise<void> => {
        await Promise.resolve();
      },
    }));
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.startGitSourceSyncMock.mockResolvedValueOnce(createPendingGitSourceSyncTaskResponseFixture());
    mocks.getGitSourceSyncTaskMock.mockResolvedValueOnce(createCompletedGitSourceSyncTaskResponseFixture());

    const result: CliCommandResult = await runCliCommand(['source', 'sync', 'src_123'], createCliCapture());

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Accepted apps: 1');
    expect(readCliStdout(result.capture)).toContain('Blocked apps: 1');
    expect(readCliStdout(result.capture)).toContain('- apps/smoke/compartment.yml\tsmoke-web');
    expect(readCliStdout(result.capture)).toContain(
      '- apps/billing/compartment.yml\tbilling\tProject "billing" already has an active Git binding.',
    );
  });

  it('fails when sync reaches a terminal failed state', async (): Promise<void> => {
    vi.doMock('node:timers/promises', (): { setTimeout: () => Promise<void> } => ({
      setTimeout: async (): Promise<void> => {
        await Promise.resolve();
      },
    }));
    const mocks: SourceCommandMocks = mockSourceCommandModules();
    mocks.startGitSourceSyncMock.mockResolvedValueOnce(createPendingGitSourceSyncTaskResponseFixture());
    mocks.getGitSourceSyncTaskMock.mockResolvedValueOnce(createFailedGitSourceSyncTaskResponseFixture());

    const result: CliCommandResult = await runCliCommand(['source', 'sync', 'src_123'], createCliCapture());

    expect(result.exitCode).toBe(1);
    expect(readCliStderr(result.capture)).toContain('Source sync sst_123 for src_123 failed: Descriptor drift');
  });
});

function mockSourceCommandModules(): SourceCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
  const disconnectSourceMock: Mock<DisconnectSource> = vi.fn<DisconnectSource>();
  const excludeSourceDescriptorMock: Mock<ExcludeSourceDescriptor> = vi.fn<ExcludeSourceDescriptor>();
  const getGitSourceSyncTaskMock: Mock<GetGitSourceSyncTask> = vi.fn<GetGitSourceSyncTask>();
  const listSourcesMock: Mock<ListSources> = vi.fn<ListSources>();
  const getGitHubSourceBootstrapStatusMock: Mock<GetGitHubSourceBootstrapStatus> =
    vi.fn<GetGitHubSourceBootstrapStatus>();
  const includeSourceDescriptorMock: Mock<IncludeSourceDescriptor> = vi.fn<IncludeSourceDescriptor>();
  const listGitProviderRepositoriesForSourceMock: Mock<ListGitProviderRepositoriesForSource> =
    vi.fn<ListGitProviderRepositoriesForSource>();
  const listGitSourceRegistrationsMock: Mock<ListGitSourceRegistrations> = vi
    .fn<ListGitSourceRegistrations>()
    .mockResolvedValue({ registrations: [] });
  const readLocalGitSourcePlanMock: Mock<ReadLocalGitSourcePlan> = vi.fn<ReadLocalGitSourcePlan>();
  const readSourceSettingsMock: Mock<ReadSourceSettings> = vi.fn<ReadSourceSettings>();
  const showSourceMock: Mock<ShowSource> = vi.fn<ShowSource>();
  const startGitSourceSyncMock: Mock<StartGitSourceSync> = vi.fn<StartGitSourceSync>();
  const startGitHubSourceBootstrapMock: Mock<StartGitHubSourceBootstrap> = vi.fn<StartGitHubSourceBootstrap>();
  const connectGitSourceMock: Mock<ConnectGitSource> = vi.fn<ConnectGitSource>();
  const updateSourceSettingsForSourceMock: Mock<UpdateSourceSettingsForSource> = vi.fn<UpdateSourceSettingsForSource>();

  vi.doMock(
    '../src/services/sources.service',
    (): SourceServiceModule => ({
      connectGitSource: connectGitSourceMock,
      disconnectSource: disconnectSourceMock,
      excludeSourceDescriptor: excludeSourceDescriptorMock,
      getGitHubSourceBootstrapStatus: getGitHubSourceBootstrapStatusMock,
      getGitSourceSyncTask: getGitSourceSyncTaskMock,
      includeSourceDescriptor: includeSourceDescriptorMock,
      listGitProviderRepositoriesForSource: listGitProviderRepositoriesForSourceMock,
      listGitSourceRegistrations: listGitSourceRegistrationsMock,
      listSources: listSourcesMock,
      readSourceSettings: readSourceSettingsMock,
      showSource: showSourceMock,
      startGitSourceSync: startGitSourceSyncMock,
      startGitHubSourceBootstrap: startGitHubSourceBootstrapMock,
      updateSourceSettingsForSource: updateSourceSettingsForSourceMock,
    }),
  );
  vi.doMock(
    '../src/services/source-git-local.service',
    (): SourceGitLocalServiceModule => ({
      readLocalGitSourcePlan: readLocalGitSourcePlanMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    connectGitSourceMock,
    disconnectSourceMock,
    excludeSourceDescriptorMock,
    getGitHubSourceBootstrapStatusMock,
    getGitSourceSyncTaskMock,
    includeSourceDescriptorMock,
    listGitProviderRepositoriesForSourceMock,
    listSourcesMock,
    readCliConfigMock,
    readLocalGitSourcePlanMock,
    readSourceSettingsMock,
    showSourceMock,
    startGitSourceSyncMock,
    startGitHubSourceBootstrapMock,
    updateSourceSettingsForSourceMock,
  };
}

function createLocalGitSourcePlanFixture(): LocalGitSourcePlan {
  return {
    providerHost: 'github.com',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function createBootstrapResponseFixture(): GitHubProviderBootstrapResponse {
  return {
    bootstrapStateId: null,
    browserUrl: null,
    installationAccountLogin: 'acme',
    installationId: '98765',
    providerHost: 'github.com',
    registrationId: 'gpr_123',
    repositoryOwner: 'acme',
    status: 'active',
  };
}

function createPendingBootstrapResponseFixture(): GitHubProviderBootstrapResponse {
  return {
    ...createBootstrapResponseFixture(),
    bootstrapStateId: 'gbs_123',
    browserUrl: 'https://github.com/apps/compartment-acme/installations/new?state=gbs_123',
    installationAccountLogin: null,
    installationId: null,
    registrationId: 'gpr_pending',
    status: 'pending',
  };
}

function createRepositoryListResponseFixture(): GitProviderRegistrationRepositoryListResponse {
  return {
    repositories: [
      {
        defaultBranchName: 'main',
        fullName: 'acme/mono',
        id: 'repo_123',
        name: 'mono',
        owner: 'acme',
        private: true,
      },
    ],
  };
}

function restoreNoColorEnv(): void {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
    return;
  }

  process.env.NO_COLOR = originalNoColor;
}

function createGitSourceResponseFixture(): GitSourceResponse {
  return {
    source: {
      autoAdoptNewApps: true,
      bindings: [
        {
          autoDeployEnabled: true,
          branchName: 'main',
          descriptorPath: 'apps/smoke/compartment.yml',
          environmentName: 'production',
          id: 'sbd_123',
          projectId: 'prj_123',
          projectName: 'smoke-web',
          status: 'active',
        },
      ],
      defaultAutoDeployEnabled: true,
      defaultBranchName: 'main',
      defaultEnvironmentName: 'production',
      displayName: 'acme/mono',
      exclusions: [],
      id: 'src_123',
      latestSync: {
        candidates: [
          {
            blockedReason: null,
            derivedWatchPaths: ['apps/smoke'],
            descriptorDirectory: 'apps/smoke',
            descriptorPath: 'apps/smoke/compartment.yml',
            id: 'ssc_accepted',
            projectName: 'smoke-web',
            status: 'accepted',
          },
          {
            blockedReason: 'Project "billing" already has an active Git binding.',
            derivedWatchPaths: [],
            descriptorDirectory: 'apps/billing',
            descriptorPath: 'apps/billing/compartment.yml',
            id: 'ssc_blocked',
            projectName: 'billing',
            status: 'blocked',
          },
        ],
        failureReason: null,
        id: 'sst_123',
        requestedBranchName: 'main',
        resolvedCommitSha: 'sha_123',
        status: 'completed',
      },
      providerHost: 'github.com',
      repositoryCloneUrl: 'https://github.com/acme/mono.git',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      status: 'active',
    },
  };
}

function createGitSourceSettingsResponseFixture(): GitSourceSettingsResponse {
  return {
    settings: {
      autoAdoptNewApps: false,
      exclusions: [
        {
          descriptorPath: 'apps/billing/compartment.yml',
        },
      ],
    },
  };
}

function createPendingGitSourceSyncTaskResponseFixture(): GitSourceSyncTaskResponse {
  return {
    task: {
      candidates: [],
      failureReason: null,
      id: 'sst_123',
      requestedBranchName: 'main',
      resolvedCommitSha: null,
      status: 'pending',
    },
  };
}

function createCompletedGitSourceSyncTaskResponseFixture(): GitSourceSyncTaskResponse {
  return {
    task: {
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: ['apps/smoke'],
          descriptorDirectory: 'apps/smoke',
          descriptorPath: 'apps/smoke/compartment.yml',
          id: 'ssc_accepted',
          projectName: 'smoke-web',
          status: 'accepted',
        },
        {
          blockedReason: 'Project "billing" already has an active Git binding.',
          derivedWatchPaths: [],
          descriptorDirectory: 'apps/billing',
          descriptorPath: 'apps/billing/compartment.yml',
          id: 'ssc_blocked',
          projectName: 'billing',
          status: 'blocked',
        },
      ],
      failureReason: null,
      id: 'sst_123',
      requestedBranchName: 'main',
      resolvedCommitSha: 'sha_123',
      status: 'completed',
    },
  };
}

function createFailedGitSourceSyncTaskResponseFixture(): GitSourceSyncTaskResponse {
  return {
    task: {
      ...createPendingGitSourceSyncTaskResponseFixture().task,
      failureReason: 'Descriptor drift',
      status: 'failed',
    },
  };
}
