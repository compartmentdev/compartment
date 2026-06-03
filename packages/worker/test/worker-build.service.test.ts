import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  CompartmentServiceKind,
  ResolvedCompartmentServiceBuildConfig,
  ResolvedCompartmentServiceRunConfig,
  WorkerBuildArtifactSummary,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { CompartmentBinaryRequester, CompartmentRequester } from '@compartment/sdk';
import { buildReleaseImageFromSource } from '../src/services/worker-build.service';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import type { PreparedWorkerSource } from '../src/services/worker-source.service.types';

interface BuildDockerImageInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  contextDirectory: string;
  dockerfilePath?: string | undefined;
  imageTag: string;
  labels?: Record<string, string> | undefined;
  onProgressLine?: ((line: { message: string; stream: 'stderr' | 'stdout' }) => void | Promise<void>) | undefined;
  packer: 'dockerfile' | 'railpack' | 'static';
  pushImageInsecureRegistry?: boolean | undefined;
  pushImageTag?: string | undefined;
  runtimeAptPackages?: string[] | undefined;
  staticOutputDirectory?: string | undefined;
}

interface DockerBuildImageResult {
  imageRef: string;
  pushed: boolean;
}

type BuildDockerImage = (input: BuildDockerImageInput) => Promise<DockerBuildImageResult>;
type PrepareServiceDirectory = (
  tempDirectory: string,
  sourceArchive: Buffer,
  service: {
    kind: CompartmentServiceKind;
    name: string;
    path: string;
  },
  build: ResolvedCompartmentServiceBuildConfig,
  requireRoutesFile: boolean,
) => Promise<PreparedWorkerSource>;

interface EventRequestBody {
  deploymentId?: string;
  deploymentRunId?: string;
  level?: string;
  message?: string;
  status?: string;
  stepKey?: string;
  stream?: string;
}

interface EventRequestOptions {
  body?: EventRequestBody;
  method: string;
  path: string;
  schema: object;
}

type EventRequest = (input: EventRequestOptions) => Promise<EventRequestBody | undefined>;

interface WorkerBuildServiceTestMocks {
  buildDockerImage: Mock<BuildDockerImage>;
  prepareServiceDirectory: Mock<PrepareServiceDirectory>;
}

const mocks: WorkerBuildServiceTestMocks = vi.hoisted(
  (): WorkerBuildServiceTestMocks => ({
    buildDockerImage: vi.fn<BuildDockerImage>(),
    prepareServiceDirectory: vi.fn<PrepareServiceDirectory>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerImage: Mock<BuildDockerImage>;
    buildDockerNamespaceLabels: (namespace: string) => Record<string, string>;
  } => ({
    buildDockerImage: mocks.buildDockerImage,
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
  }),
);

vi.mock('../src/services/worker-source.service', (): { prepareServiceDirectory: Mock<PrepareServiceDirectory> } => ({
  prepareServiceDirectory: mocks.prepareServiceDirectory,
}));

afterEach((): void => {
  mocks.buildDockerImage.mockReset();
  mocks.prepareServiceDirectory.mockReset();
});

describe('buildReleaseImageFromSource', (): void => {
  it('reuses an existing artifact image without downloading source', async (): Promise<void> => {
    const eventRequestMock: Mock<EventRequest> = vi.fn<EventRequest>().mockResolvedValue(undefined);
    const eventRequest: CompartmentRequester = (async (
      options: EventRequestOptions,
    ): Promise<EventRequestBody | undefined> => await eventRequestMock(options)) as CompartmentRequester;
    const request: CompartmentBinaryRequester = async (): Promise<Buffer> => await Promise.resolve(Buffer.from('test'));

    await expect(
      buildReleaseImageFromSource(
        eventRequest,
        request,
        createClaimedDeployment({
          artifact: {
            id: 'art_123',
            imageRef: 'sha256:existing-image',
            sourceDigest: 'sha256:source',
          },
        }),
        'compartment-e2e',
        createArtifactRegistryConfig(),
      ),
    ).resolves.toBe('sha256:existing-image');

    expect(mocks.prepareServiceDirectory).not.toHaveBeenCalled();
    expect(mocks.buildDockerImage).not.toHaveBeenCalled();
    expect(eventRequestMock).toHaveBeenCalledTimes(1);
    expect(eventRequestMock.mock.calls[0]?.[0]).toMatchObject({
      body: {
        deploymentId: 'dep_123',
        deploymentRunId: 'drn_123',
        level: 'info',
        message: 'worker claimed deployment',
        status: 'succeeded',
        stepKey: 'queued',
        stream: 'compartment',
      },
      method: 'POST',
      path: '/internal/deployments/runtime-events',
    });
  });

  it('builds from source and returns the BuildKit-pushed image ref', async (): Promise<void> => {
    const getArtifactSourceArchiveSpy: Mock<(artifactId: string) => Promise<Buffer>> = vi
      .fn<(artifactId: string) => Promise<Buffer>>()
      .mockResolvedValueOnce(Buffer.from('test'));
    const eventRequest: CompartmentRequester = vi.fn() as CompartmentRequester;
    const request: CompartmentBinaryRequester = async ({ path }: { path: string }): Promise<Buffer> => {
      const artifactId: string = path.split('/')[3] ?? '';
      return await getArtifactSourceArchiveSpy(artifactId);
    };
    mocks.prepareServiceDirectory.mockResolvedValueOnce({
      buildContextDirectory: '/tmp/source',
      buildAptPackages: [],
      dockerfilePath: 'apps/web/Dockerfile',
      packer: 'dockerfile',
      runtimeAptPackages: [],
      serviceRelativePath: 'apps/web',
    });
    mocks.buildDockerImage.mockResolvedValueOnce({
      imageRef: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:rebuilt-image',
      pushed: true,
    });

    await expect(
      buildReleaseImageFromSource(
        eventRequest,
        request,
        createClaimedDeployment({
          artifact: {
            id: 'art_123',
            imageRef: null,
            sourceDigest: 'sha256:source',
          },
          buildEnv: {
            VITE_PUBLIC_GREETING: 'hello from build env',
          },
        }),
        'compartment-e2e',
        createArtifactRegistryConfig(),
      ),
    ).resolves.toBe('127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:rebuilt-image');

    expect(getArtifactSourceArchiveSpy).toHaveBeenCalledWith('art_123');
    expect(mocks.prepareServiceDirectory).toHaveBeenCalled();
    expect(mocks.buildDockerImage).toHaveBeenCalledWith(
      expect.objectContaining({
        contextDirectory: '/tmp/source',
        dockerfilePath: 'apps/web/Dockerfile',
        imageTag: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123:art_123',
        pushImageInsecureRegistry: true,
        pushImageTag: 'registry:5000/compartment/projects/prj_123/services/svc_123:art_123',
      }),
    );
  });

  it('rejects non-pushed build results instead of falling back to docker push', async (): Promise<void> => {
    const getArtifactSourceArchiveSpy: Mock<(artifactId: string) => Promise<Buffer>> = vi
      .fn<(artifactId: string) => Promise<Buffer>>()
      .mockResolvedValueOnce(Buffer.from('test'));
    const eventRequest: CompartmentRequester = vi.fn() as CompartmentRequester;
    const request: CompartmentBinaryRequester = async ({ path }: { path: string }): Promise<Buffer> => {
      const artifactId: string = path.split('/')[3] ?? '';
      return await getArtifactSourceArchiveSpy(artifactId);
    };
    mocks.prepareServiceDirectory.mockResolvedValueOnce({
      buildContextDirectory: '/tmp/source',
      buildAptPackages: [],
      dockerfilePath: 'apps/web/Dockerfile',
      packer: 'dockerfile',
      runtimeAptPackages: [],
      serviceRelativePath: 'apps/web',
    });
    mocks.buildDockerImage.mockResolvedValueOnce({
      imageRef: 'sha256:local-image-id',
      pushed: false,
    });

    await expect(
      buildReleaseImageFromSource(
        eventRequest,
        request,
        createClaimedDeployment({
          artifact: {
            id: 'art_123',
            imageRef: null,
            sourceDigest: 'sha256:source',
          },
        }),
        'compartment-e2e',
        createArtifactRegistryConfig(),
      ),
    ).rejects.toThrow(
      'Expected source image build for "127.0.0.1:5517/compartment/projects/prj_123/services/svc_123:art_123" to push directly through BuildKit.',
    );

    expect(mocks.buildDockerImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123:art_123',
        pushImageInsecureRegistry: true,
        pushImageTag: 'registry:5000/compartment/projects/prj_123/services/svc_123:art_123',
      }),
    );
  });

  it('rejects run commands when the prepared source resolves to Dockerfile', async (): Promise<void> => {
    const eventRequest: CompartmentRequester = vi.fn() as CompartmentRequester;
    const request: CompartmentBinaryRequester = async (): Promise<Buffer> => await Promise.resolve(Buffer.from('test'));
    mocks.prepareServiceDirectory.mockResolvedValueOnce({
      buildContextDirectory: '/tmp/source',
      buildAptPackages: [],
      dockerfilePath: 'apps/web/Dockerfile',
      packer: 'dockerfile',
      runtimeAptPackages: [],
      serviceRelativePath: 'apps/web',
    });

    await expect(
      buildReleaseImageFromSource(
        eventRequest,
        request,
        createClaimedDeployment({
          artifact: {
            id: 'art_123',
            imageRef: null,
            sourceDigest: 'sha256:source',
          },
          run: {
            command: 'node server.js',
            restart: {
              policy: 'on-failure',
            },
          },
        }),
        'compartment-e2e',
        createArtifactRegistryConfig(),
      ),
    ).rejects.toThrow('Run command is only supported for services with an authored runtime process.');

    expect(mocks.buildDockerImage).not.toHaveBeenCalled();
  });

  it('rejects static services when source preparation does not resolve build.outputDirectory', async (): Promise<void> => {
    const eventRequest: CompartmentRequester = vi.fn() as CompartmentRequester;
    const request: CompartmentBinaryRequester = async (): Promise<Buffer> => await Promise.resolve(Buffer.from('test'));
    mocks.prepareServiceDirectory.mockResolvedValueOnce({
      buildContextDirectory: '/tmp/source',
      buildAptPackages: [],
      packer: 'static',
      runtimeAptPackages: [],
      serviceRelativePath: '.',
    });

    await expect(
      buildReleaseImageFromSource(
        eventRequest,
        request,
        createClaimedDeployment({
          artifact: {
            id: 'art_123',
            imageRef: null,
            sourceDigest: 'sha256:source',
          },
          service: {
            build: {
              env: [],
              include: [],
              outputDirectory: 'dist',
              packages: {
                build: [],
                runtime: [],
              },
              strategy: 'auto',
            },
            id: 'svc_123',
            kind: 'static',
            name: 'site',
            path: '.',
          },
        }),
        'compartment-e2e',
        createArtifactRegistryConfig(),
      ),
    ).rejects.toThrow('Static services must resolve build.outputDirectory before image build.');

    expect(mocks.buildDockerImage).not.toHaveBeenCalled();
  });
});

function createArtifactRegistryConfig(): WorkerArtifactRegistryConfig {
  return {
    address: '127.0.0.1:5517',
    internalUrl: 'http://registry:5000',
    readCredentials: {
      password: 'read-password',
      username: 'reader',
    },
    writeCredentials: {
      password: 'write-password',
      username: 'writer',
    },
  };
}

function createClaimedDeployment(
  input: Partial<WorkerClaimedDeployment> & { artifact?: WorkerBuildArtifactSummary } = {},
): WorkerClaimedDeployment {
  return {
    artifact: input.artifact ?? {
      id: 'art_123',
      imageRef: null,
      sourceDigest: 'sha256:source',
    },
    deploymentId: 'dep_123',
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    environmentName: 'production',
    node: {
      id: 'node_123',
      name: 'local-node',
      nodeSocketPath: '/tmp/compartment/worker-test/node/agent.sock',
    },
    previousDeployment: undefined,
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    release: null,
    requiresSourceRoutesFile: false,
    run: createRun(),
    routeHost: 'smoke-web.localhost',
    buildEnv: {},
    runtimeEnv: {},
    runtimeNetwork: {
      requiresResourceNetwork: false,
    },
    service: {
      build: {
        env: [],
        include: [],
        packages: {
          build: [],
          runtime: [],
        },
        strategy: 'auto',
      },
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
    },
    ...input,
  };
}

function createRun(): ResolvedCompartmentServiceRunConfig {
  return {
    restart: {
      policy: 'on-failure',
    },
  };
}
