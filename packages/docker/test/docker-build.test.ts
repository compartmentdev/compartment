import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as BuildkitCommandModule from '../src/buildkit-command';
import { buildDockerImage, hasDockerImage, inspectDockerImage, prewarmSourceBuildToolchain } from '../src/docker-build';
import type { DockerCommandResult } from '../src/docker-command.types';
import type { DockerProgressReporter, DockerRegistryCredentials } from '../src/docker-models';
import type { PrepareRailpackPlanInput } from '../src/railpack-command.types';

type RunDockerCommand = (args: string[]) => Promise<DockerCommandResult>;
type RunBuildctlCommandWithOptionalProgressReporter = (
  args: string[],
  onProgressLine: DockerProgressReporter | undefined,
  registryCredentials?: DockerRegistryCredentials,
) => Promise<void>;
type RunBuildctlCommandWithRegistryRetry = (
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
) => Promise<DockerCommandResult>;
type PrepareRailpackPlan = (input: PrepareRailpackPlanInput) => Promise<void>;

interface DockerBuildTestMocks {
  prepareRailpackPlan: Mock<PrepareRailpackPlan>;
  runBuildctlCommandWithOptionalProgressReporter: Mock<RunBuildctlCommandWithOptionalProgressReporter>;
  runBuildctlCommandWithRegistryRetry: Mock<RunBuildctlCommandWithRegistryRetry>;
  runDockerCommand: Mock<RunDockerCommand>;
}

const mocks: DockerBuildTestMocks = vi.hoisted(
  (): DockerBuildTestMocks => ({
    prepareRailpackPlan: vi.fn<PrepareRailpackPlan>(),
    runBuildctlCommandWithOptionalProgressReporter: vi.fn<RunBuildctlCommandWithOptionalProgressReporter>(),
    runBuildctlCommandWithRegistryRetry: vi.fn<RunBuildctlCommandWithRegistryRetry>(),
    runDockerCommand: vi.fn<RunDockerCommand>(),
  }),
);

vi.mock('../src/docker-command', (): { runDockerCommand: Mock<RunDockerCommand> } => ({
  runDockerCommand: mocks.runDockerCommand,
}));

vi.mock(
  '../src/buildkit-command',
  async (importOriginal: () => Promise<typeof BuildkitCommandModule>): Promise<typeof BuildkitCommandModule> => {
    const actual: typeof BuildkitCommandModule = await importOriginal();

    return {
      ...actual,
      runBuildctlCommandWithOptionalProgressReporter: mocks.runBuildctlCommandWithOptionalProgressReporter,
      runBuildctlCommandWithRegistryRetry: mocks.runBuildctlCommandWithRegistryRetry,
    };
  },
);

vi.mock('../src/railpack-command', (): { prepareRailpackPlan: Mock<PrepareRailpackPlan> } => ({
  prepareRailpackPlan: mocks.prepareRailpackPlan,
}));

beforeEach((): void => {
  delete process.env.BUILDKIT_ADDR;
  mocks.prepareRailpackPlan.mockReset();
  mocks.runBuildctlCommandWithOptionalProgressReporter.mockReset();
  mocks.runBuildctlCommandWithRegistryRetry.mockReset();
  mocks.runDockerCommand.mockReset();
});

afterEach((): void => {
  delete process.env.BUILDKIT_ADDR;
});

describe('buildDockerImage', (): void => {
  it('requires the remote BuildKit address for image builds', async (): Promise<void> => {
    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('BUILDKIT_ADDR is required for remote BuildKit source builds.');

    expect(mocks.runBuildctlCommandWithOptionalProgressReporter).not.toHaveBeenCalled();
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it('builds and pushes a dockerfile image through remote BuildKit', async (): Promise<void> => {
    const digest: string = `sha256:${'a'.repeat(64)}`;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        buildEnv: {
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
        },
        contextDirectory: '/tmp/source',
        dockerfilePath: 'apps/web/Dockerfile',
        imageTag: 'registry.example/compartment-web:art_123',
        labels: {
          'compartment.namespace': 'compartment-e2e',
        },
        packer: 'dockerfile',
        pushImageInsecureRegistry: true,
        pushImageTag: 'registry:5000/compartment-web:art_123',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    expect(mocks.runBuildctlCommandWithOptionalProgressReporter).toHaveBeenNthCalledWith(
      1,
      [
        '--addr',
        'tcp://builder:1234',
        'build',
        '--frontend',
        'dockerfile.v0',
        '--local',
        'context=/tmp/source',
        '--local',
        'dockerfile=/tmp/source/apps/web',
        '--opt',
        'filename=Dockerfile',
        '--opt',
        'build-arg:NEXT_PUBLIC_API_URL=https://api.example.com',
        '--opt',
        'label:compartment.namespace=compartment-e2e',
        '--output',
        'type=image,name=registry:5000/compartment-web:art_123,push=true,registry.insecure=true',
        '--metadata-file',
        expect.stringMatching(/buildkit-metadata\.json$/),
      ],
      undefined,
      undefined,
    );
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it('resolves the default Dockerfile path against the remote BuildKit context', async (): Promise<void> => {
    const digest: string = `sha256:${'c'.repeat(64)}`;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
        pushImageInsecureRegistry: true,
        pushImageTag: 'registry:5000/compartment-web:art_123',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    expect(mocks.runBuildctlCommandWithOptionalProgressReporter).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        '--local',
        'context=/tmp/source',
        '--local',
        'dockerfile=/tmp/source',
        '--opt',
        'filename=Dockerfile',
      ]),
      undefined,
      undefined,
    );
  });

  it('uses plain BuildKit progress output when a dockerfile build is tracked', async (): Promise<void> => {
    const digest: string = `sha256:${'d'.repeat(64)}`;
    const onProgressLine: DockerProgressReporter = vi.fn<DockerProgressReporter>();

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        onProgressLine,
        packer: 'dockerfile',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    expect(mocks.runBuildctlCommandWithOptionalProgressReporter).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(['--addr', 'tcp://builder:1234', 'build', '--progress=plain']),
      onProgressLine,
      undefined,
    );
  });

  it('builds and pushes a Railpack-backed image through remote BuildKit', async (): Promise<void> => {
    const digest: string = `sha256:${'b'.repeat(64)}`;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.prepareRailpackPlan.mockResolvedValueOnce();
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        appPath: 'apps/web',
        buildEnv: {
          HOME: '/tmp/project-home',
          PATH: '/project/bin',
        },
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        labels: {
          'compartment.namespace': 'compartment-e2e',
        },
        packer: 'railpack',
        pushImageInsecureRegistry: true,
        pushImageTag: 'registry:5000/compartment-web:art_123',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    const railpackInput: PrepareRailpackPlanInput | undefined = mocks.prepareRailpackPlan.mock.calls[0]?.[0];
    const buildctlArgs: string[] | undefined = mocks.runBuildctlCommandWithOptionalProgressReporter.mock.calls[0]?.[0];

    expect(railpackInput?.appPath).toBe('apps/web');
    expect(railpackInput?.contextDirectory).toBe('/tmp/source');
    expect(buildctlArgs).toEqual(
      expect.arrayContaining([
        '--addr',
        'tcp://builder:1234',
        'build',
        '--frontend',
        'gateway.v0',
        '--local',
        'context=/tmp/source',
        '--opt',
        expect.stringMatching(/^source=ghcr\.io\/railwayapp\/railpack-frontend@sha256:[a-f0-9]{64}$/u),
        '--opt',
        'label:compartment.namespace=compartment-e2e',
        '--opt',
        expect.stringMatching(/^secrets-hash=[a-f0-9]{64}$/u),
        '--secret',
        expect.stringMatching(/^id=HOME,src=.*build-secret-0\.txt$/),
        '--secret',
        expect.stringMatching(/^id=PATH,src=.*build-secret-1\.txt$/),
        '--output',
        'type=image,name=registry:5000/compartment-web:art_123,push=true,registry.insecure=true',
      ]),
    );
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it('passes Railpack apt package env values as BuildKit secrets for the generated plan', async (): Promise<void> => {
    const digest: string = `sha256:${'e'.repeat(64)}`;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.prepareRailpackPlan.mockResolvedValueOnce();
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        appPath: 'apps/web',
        buildAptPackages: ['build-essential'],
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'railpack',
        runtimeAptPackages: ['jq'],
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    const buildctlArgs: string[] | undefined = mocks.runBuildctlCommandWithOptionalProgressReporter.mock.calls[0]?.[0];

    expect(buildctlArgs).toContain('--opt');
    expect(buildctlArgs).toContainEqual(expect.stringMatching(/^secrets-hash=[a-f0-9]{64}$/u));
    expect(buildctlArgs).toContain('--secret');
    expect(buildctlArgs).toContainEqual(
      expect.stringMatching(/^id=RAILPACK_BUILD_APT_PACKAGES,src=.*build-secret-0\.txt$/),
    );
    expect(buildctlArgs).toContainEqual(
      expect.stringMatching(/^id=RAILPACK_DEPLOY_APT_PACKAGES,src=.*build-secret-1\.txt$/),
    );
  });

  it('preserves the generated Caddyfile in a narrowed starter-static deploy plan', async (): Promise<void> => {
    const digest: string = `sha256:${'f'.repeat(64)}`;
    let normalizedPlanText: string = '';

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.prepareRailpackPlan.mockImplementationOnce(async (input: PrepareRailpackPlanInput): Promise<void> => {
      await writeFile(
        input.planPath,
        JSON.stringify(
          {
            deploy: {
              inputs: [
                {
                  include: ['/railpack/caddy'],
                  step: 'packages:caddy',
                },
                {
                  include: ['.'],
                  step: 'build',
                },
              ],
              startCommand: 'caddy run --config Caddyfile --adapter caddyfile 2>&1',
            },
            steps: [
              {
                assets: {
                  Caddyfile: ':{$PORT:80} {\n\trespond /health 200\n\troot * .\n\tfile_server\n}\n',
                },
                name: 'build',
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );
    });
    mocks.runBuildctlCommandWithOptionalProgressReporter.mockImplementationOnce(
      async (args: string[]): Promise<void> => {
        const railpackInput: PrepareRailpackPlanInput | undefined = mocks.prepareRailpackPlan.mock.calls[0]?.[0];
        if (railpackInput === undefined) {
          throw new Error('Expected Railpack plan input.');
        }
        normalizedPlanText = await readFile(railpackInput.planPath, 'utf8');
        await writeBuildKitMetadata(args, digest);
      },
    );

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        labels: {
          'compartment.namespace': 'compartment-e2e',
        },
        packer: 'static',
        staticOutputDirectory: 'apps/site',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    const railpackInput: PrepareRailpackPlanInput | undefined = mocks.prepareRailpackPlan.mock.calls[0]?.[0];
    expect(railpackInput?.appPath).toBeUndefined();
    expect(railpackInput?.buildCommand).toBeUndefined();
    expect(railpackInput?.staticOutputDirectory).toBe('apps/site');
    expect(JSON.parse(normalizedPlanText)).toMatchObject({
      deploy: {
        inputs: [
          {
            include: ['/railpack/caddy'],
            step: 'packages:caddy',
          },
          {
            include: ['apps/site', '/Caddyfile'],
            step: 'build',
          },
        ],
      },
    });
    expect(normalizedPlanText).not.toContain('"include": [\n          "."\n        ]');
  });
});

describe('prewarmSourceBuildToolchain', (): void => {
  it('requires the remote BuildKit address for source build prewarm', async (): Promise<void> => {
    await expect(prewarmSourceBuildToolchain()).rejects.toThrow(
      'BUILDKIT_ADDR is required for remote BuildKit source builds.',
    );

    expect(mocks.runBuildctlCommandWithRegistryRetry).not.toHaveBeenCalled();
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it('warms the remote BuildKit Railpack toolchain', async (): Promise<void> => {
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.prepareRailpackPlan.mockResolvedValueOnce();
    mocks.runBuildctlCommandWithRegistryRetry.mockResolvedValueOnce({ stderr: '', stdout: '' });

    await expect(prewarmSourceBuildToolchain()).resolves.toBeUndefined();

    const railpackInput: PrepareRailpackPlanInput | undefined = mocks.prepareRailpackPlan.mock.calls[0]?.[0];
    const prewarmDirectory: string = railpackInput?.contextDirectory ?? '';

    expect(prewarmDirectory).toMatch(/compartment-source-build-prewarm-/);
    expect(mocks.runBuildctlCommandWithRegistryRetry).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        '--addr',
        'tcp://builder:1234',
        'build',
        '--frontend',
        'gateway.v0',
        '--local',
        `context=${prewarmDirectory}`,
        '--local',
        `dockerfile=${prewarmDirectory}`,
        '--opt',
        expect.stringMatching(/^source=ghcr\.io\/railwayapp\/railpack-frontend@sha256:[a-f0-9]{64}$/u),
      ]),
    );
    expect(mocks.runBuildctlCommandWithRegistryRetry.mock.calls[0]?.[0]).not.toContain('--output');
  });
});

describe('inspectDockerImage', (): void => {
  it('reports when the image exists locally', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{"ExposedPorts":{"3000/tcp":{}}}',
    });

    await expect(hasDockerImage({ imageRef: 'sha256:image-id' })).resolves.toBe(true);
  });

  it('reports when the image is missing locally', async (): Promise<void> => {
    const error: Error & { stderr?: string | undefined } = new Error('docker image inspect failed');
    error.stderr = 'Error response from daemon: No such image: sha256:image-id';
    mocks.runDockerCommand.mockRejectedValueOnce(error);

    await expect(hasDockerImage({ imageRef: 'sha256:image-id' })).resolves.toBe(false);
  });

  it('parses exposed ports from image inspect output', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{"ExposedPorts":{"3000/tcp":{},"3001/udp":{}}}',
    });

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).resolves.toEqual({
      exposedPorts: [3000],
      imageRef: 'sha256:image-id',
    });
  });

  it('parses entrypoint from image inspect output', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{"Entrypoint":["/bin/bash","-l","-c"],"ExposedPorts":{"3000/tcp":{}}}',
    });

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).resolves.toEqual({
      entrypoint: ['/bin/bash', '-l', '-c'],
      exposedPorts: [3000],
      imageRef: 'sha256:image-id',
    });
  });

  it('ignores malformed entrypoint values from image inspect output', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{"Entrypoint":["/bin/bash",42],"ExposedPorts":{"3000/tcp":{}}}',
    });

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).resolves.toEqual({
      exposedPorts: [3000],
      imageRef: 'sha256:image-id',
    });
  });

  it('ignores UDP-only exposed ports from image inspect output', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{"ExposedPorts":{"3001/udp":{}}}',
    });

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).resolves.toEqual({
      exposedPorts: [],
      imageRef: 'sha256:image-id',
    });
  });

  it('returns an empty port list when the image config omits exposed ports', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: '{}',
    });

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).resolves.toEqual({
      exposedPorts: [],
      imageRef: 'sha256:image-id',
    });
  });

  it('rejects when the image is missing', async (): Promise<void> => {
    const error: Error & { stderr?: string | undefined } = new Error('docker image inspect failed');
    error.stderr = 'Error response from daemon: No such image: sha256:image-id';
    mocks.runDockerCommand.mockRejectedValueOnce(error);

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).rejects.toThrow(
      'Expected docker image "sha256:image-id" to exist.',
    );
  });

  it('rethrows non-Error inspect failures without masking them behind a TypeError', async (): Promise<void> => {
    mocks.runDockerCommand.mockRejectedValueOnce(null);

    await expect(inspectDockerImage({ imageRef: 'sha256:image-id' })).rejects.toBeNull();
  });
});

function mockBuildKitImageOutput(digest: string): void {
  mocks.runBuildctlCommandWithOptionalProgressReporter.mockImplementationOnce(async (args: string[]): Promise<void> => {
    await writeBuildKitMetadata(args, digest);
  });
}

async function writeBuildKitMetadata(args: readonly string[], digest: string): Promise<void> {
  const metadataFile: string | undefined = args[args.indexOf('--metadata-file') + 1];
  if (metadataFile === undefined) {
    throw new Error('Expected test BuildKit args to include --metadata-file.');
  }

  await writeFile(
    metadataFile,
    JSON.stringify({
      'containerimage.digest': digest,
    }),
    'utf8',
  );
}
