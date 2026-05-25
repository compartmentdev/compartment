import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CompartmentAuthoredDescriptor, DeployResponse, DeploymentStatusResponse } from '@compartment/contracts';
import type * as CompartmentSdk from '@compartment/sdk';
import type {
  CompartmentRequester,
  deployProject as deployProjectApi,
  promoteDeployment,
  rollbackDeployment,
} from '@compartment/sdk';
import type * as SourceArchiveModule from '@compartment/source-archive';
import type { createSourceArchive } from '@compartment/source-archive';
import { deployProject } from '../src/services/deployments.service';
import { promoteProjectDeployment, rollbackProjectDeployment } from '../src/services/deployment-movement.service';
import type * as DeploymentOperationRunnerModule from '../src/services/deployment-operation-runner.service';
import type {
  createProjectRequester,
  waitForDeploymentOperationCompletion,
} from '../src/services/deployment-operation-runner.service';
import type * as ProjectTargetServiceModule from '../src/services/project-target.service';
import type { resolveProjectTarget } from '../src/services/project-target.service';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { StoredProjectDescriptor } from '../src/services/project-descriptor.types';
import type { ResolvedProjectTarget } from '../src/services/projects.service.types';
import { createActiveDeploymentStatusResponseFixture, createDeployResponseFixture } from './cli-test.fixtures';

type CreateProjectRequester = typeof createProjectRequester;
type CreateSourceArchive = typeof createSourceArchive;
type DeployProjectApi = typeof deployProjectApi;
type ImportCompartmentSdkOriginal = () => Promise<typeof CompartmentSdk>;
type PromoteDeploymentApi = typeof promoteDeployment;
type ResolveProjectTarget = typeof resolveProjectTarget;
type RollbackDeploymentApi = typeof rollbackDeployment;
type WaitForDeploymentOperationCompletion = typeof waitForDeploymentOperationCompletion;

interface DeploymentProgressServiceMocks {
  createProjectRequester: Mock<CreateProjectRequester>;
  createSourceArchive: Mock<CreateSourceArchive>;
  deployProjectApi: Mock<DeployProjectApi>;
  promoteDeploymentApi: Mock<PromoteDeploymentApi>;
  resolveProjectTarget: Mock<ResolveProjectTarget>;
  rollbackDeploymentApi: Mock<RollbackDeploymentApi>;
  waitForDeploymentOperationCompletion: Mock<WaitForDeploymentOperationCompletion>;
}

const mocks: DeploymentProgressServiceMocks = vi.hoisted(
  (): DeploymentProgressServiceMocks => ({
    createProjectRequester: vi.fn<CreateProjectRequester>(),
    createSourceArchive: vi.fn<CreateSourceArchive>(),
    deployProjectApi: vi.fn<DeployProjectApi>(),
    promoteDeploymentApi: vi.fn<PromoteDeploymentApi>(),
    resolveProjectTarget: vi.fn<ResolveProjectTarget>(),
    rollbackDeploymentApi: vi.fn<RollbackDeploymentApi>(),
    waitForDeploymentOperationCompletion: vi.fn<WaitForDeploymentOperationCompletion>(),
  }),
);

vi.mock('@compartment/sdk', async (importOriginal: ImportCompartmentSdkOriginal): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await importOriginal();
  return {
    ...actual,
    deployProject: mocks.deployProjectApi,
    promoteDeployment: mocks.promoteDeploymentApi,
    rollbackDeployment: mocks.rollbackDeploymentApi,
  };
});

vi.mock(
  '@compartment/source-archive',
  (): Pick<typeof SourceArchiveModule, 'createSourceArchive'> => ({
    createSourceArchive: mocks.createSourceArchive,
  }),
);

vi.mock(
  '../src/services/deployment-operation-runner.service',
  (): Pick<
    typeof DeploymentOperationRunnerModule,
    'createProjectRequester' | 'waitForDeploymentOperationCompletion'
  > => ({
    createProjectRequester: mocks.createProjectRequester,
    waitForDeploymentOperationCompletion: mocks.waitForDeploymentOperationCompletion,
  }),
);

vi.mock(
  '../src/services/project-target.service',
  (): Pick<typeof ProjectTargetServiceModule, 'resolveProjectTarget'> => ({
    resolveProjectTarget: mocks.resolveProjectTarget,
  }),
);

describe('deployment progress services', (): void => {
  beforeEach((): void => {
    const deployResponse: DeployResponse = createDeployResponseFixture();
    const statusResponse: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();

    mocks.createProjectRequester.mockReset();
    mocks.createSourceArchive.mockReset();
    mocks.deployProjectApi.mockReset();
    mocks.promoteDeploymentApi.mockReset();
    mocks.resolveProjectTarget.mockReset();
    mocks.rollbackDeploymentApi.mockReset();
    mocks.waitForDeploymentOperationCompletion.mockReset();

    mocks.createProjectRequester.mockReturnValue(createRequester());
    mocks.createSourceArchive.mockResolvedValue({
      archiveRoot: '/tmp/smoke-web',
      sourceArchive: Buffer.from('archive'),
      sourcePackageMetadata: {
        descriptorDirectoryRelativePath: '.',
        version: 1,
      },
    });
    mocks.deployProjectApi.mockResolvedValue(deployResponse);
    mocks.promoteDeploymentApi.mockResolvedValue(deployResponse);
    mocks.resolveProjectTarget.mockResolvedValue(createResolvedProjectTarget());
    mocks.rollbackDeploymentApi.mockResolvedValue(deployResponse);
    mocks.waitForDeploymentOperationCompletion.mockResolvedValue(statusResponse);
  });

  it('reports deploy phases from the service path', async (): Promise<void> => {
    const progressMessages: string[] = [];

    await deployProject(createAuthenticatedContext(), {
      cwd: '/tmp/smoke-web',
      reportProgress: (message: string): void => {
        progressMessages.push(message);
      },
    });

    expect(progressMessages).toEqual([
      'Resolving deployment target...',
      'Preparing source archive...',
      'Submitting deployment...',
      'Waiting for deployment to finish...',
    ]);
  });

  it('reports promote and rollback phases from the service path', async (): Promise<void> => {
    const promoteProgressMessages: string[] = [];
    const rollbackProgressMessages: string[] = [];

    await promoteProjectDeployment(createAuthenticatedContext(), {
      cwd: '/tmp/smoke-web',
      reportProgress: (message: string): void => {
        promoteProgressMessages.push(message);
      },
      scope: {
        kind: 'service',
        serviceName: 'web',
      },
      sourceEnvironmentName: 'staging',
      targetEnvironmentName: 'production',
    });
    await rollbackProjectDeployment(createAuthenticatedContext(), {
      cwd: '/tmp/smoke-web',
      reportProgress: (message: string): void => {
        rollbackProgressMessages.push(message);
      },
      target: {
        mode: 'previous',
        scope: {
          kind: 'service',
          serviceName: 'web',
        },
      },
    });

    expect(promoteProgressMessages).toEqual([
      'Resolving deployment target...',
      'Promoting deployment...',
      'Waiting for deployment promotion...',
    ]);
    expect(rollbackProgressMessages).toEqual([
      'Resolving deployment target...',
      'Rolling back deployment...',
      'Waiting for deployment rollback...',
    ]);
  });
});

function createAuthenticatedContext(): AuthenticatedContext {
  return {
    apiUrl: 'https://console.example',
    currentOrganization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    remoteName: 'default',
    sessionToken: 'session_123',
  };
}

function createRequester(): CompartmentRequester {
  return async function testCompartmentRequester<TResult, TBody>(options: {
    body?: TBody | undefined;
  }): Promise<TResult> {
    await Promise.resolve();
    void options;
    throw new Error('Unexpected test request.');
  };
}

function createResolvedProjectTarget(): ResolvedProjectTarget {
  return {
    descriptor: createStoredProjectDescriptor(),
    projectName: 'smoke-web',
    updatesLocalDescriptor: true,
  };
}

function createStoredProjectDescriptor(): StoredProjectDescriptor {
  const descriptor: CompartmentAuthoredDescriptor = {
    name: 'smoke-web',
    services: {
      web: '.',
    },
  };

  return {
    descriptor,
    filePath: '/tmp/smoke-web/compartment.yml',
  };
}
