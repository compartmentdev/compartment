import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as BuildkitCommandModule from '../src/buildkit-command';
import { buildDockerImage } from '../src/docker-build';
import { buildDockerfileBuildctlArgs } from '../src/docker-buildkit-args';
import type { DockerBuildImageInput, DockerProgressReporter, DockerRegistryCredentials } from '../src/docker-models';
import type { PrepareRailpackPlanInput } from '../src/railpack-command.types';

type RunBuildctlCommandWithOptionalProgressReporter = (
  args: string[],
  onProgressLine: DockerProgressReporter | undefined,
  registryCredentials?: DockerRegistryCredentials,
) => Promise<void>;
type PrepareRailpackPlan = (input: PrepareRailpackPlanInput) => Promise<void>;

const testImageDigest: string = `sha256:${'e'.repeat(64)}`;

interface DockerBuildTestMocks {
  prepareRailpackPlan: Mock<PrepareRailpackPlan>;
  runBuildctlCommandWithOptionalProgressReporter: Mock<RunBuildctlCommandWithOptionalProgressReporter>;
}

const mocks: DockerBuildTestMocks = vi.hoisted(
  (): DockerBuildTestMocks => ({
    prepareRailpackPlan: vi.fn<PrepareRailpackPlan>(),
    runBuildctlCommandWithOptionalProgressReporter: vi.fn<RunBuildctlCommandWithOptionalProgressReporter>(),
  }),
);

vi.mock(
  '../src/buildkit-command',
  async (importOriginal: () => Promise<typeof BuildkitCommandModule>): Promise<typeof BuildkitCommandModule> => {
    const actual: typeof BuildkitCommandModule = await importOriginal();

    return {
      ...actual,
      runBuildctlCommandWithOptionalProgressReporter: mocks.runBuildctlCommandWithOptionalProgressReporter,
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
  });

  it('returns an immutable digest reference after a Dockerfile image push', async (): Promise<void> => {
    const digest: string = testImageDigest;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });
  });

  it('rejects malformed pushed image digest metadata', async (): Promise<void> => {
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput('latest');

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('Expected BuildKit metadata to include a valid SHA-256 image digest.');
  });

  it('applies the canonical compression policy to image and registry cache exporters', (): void => {
    const args: string[] = buildDockerfileBuildctlArgs({
      buildKitAddress: 'tcp://builder:1234',
      input: {
        cacheImageRef: 'registry:5000/compartment-web:build-cache',
        contextDirectory: '/tmp/source',
        imageTag: 'registry:5000/compartment-web:art_123',
        packer: 'dockerfile',
        pushImageInsecureRegistry: true,
      },
      metadataFile: '/tmp/buildkit-metadata.json',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--import-cache',
        'type=registry,ref=registry:5000/compartment-web:build-cache,registry.insecure=true',
        '--export-cache',
        'type=registry,ref=registry:5000/compartment-web:build-cache,mode=min,image-manifest=true,compression=zstd,compression-level=1,oci-mediatypes=true,registry.insecure=true',
        'type=image,name=registry:5000/compartment-web:art_123,push=true,compression=zstd,compression-level=1,oci-mediatypes=true,registry.insecure=true',
      ]),
    );
  });

  it('resolves the default Dockerfile path against the remote BuildKit context', async (): Promise<void> => {
    const digest: string = testImageDigest;

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
    const digest: string = testImageDigest;
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
    const digest: string = testImageDigest;

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
        cacheImageRef: 'registry:5000/compartment-web:build-cache',
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
        '--export-cache',
        'type=registry,ref=registry:5000/compartment-web:build-cache,mode=min,image-manifest=true,compression=zstd,compression-level=1,oci-mediatypes=true,registry.insecure=true',
        '--output',
        'type=image,name=registry:5000/compartment-web:art_123,push=true,compression=zstd,compression-level=1,oci-mediatypes=true,registry.insecure=true',
      ]),
    );
  });

  it('passes Railpack apt package env values as BuildKit secrets for the generated plan', async (): Promise<void> => {
    const digest: string = testImageDigest;

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

  it('builds a static image with a narrowed deploy plan', async (): Promise<void> => {
    const digest: string = testImageDigest;
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
                  include: ['/Caddyfile'],
                  step: 'caddy',
                },
                {
                  include: ['public-docs/dist'],
                  step: 'build',
                },
                {
                  include: ['.'],
                  step: 'build',
                },
              ],
              startCommand: 'caddy run --config Caddyfile --adapter caddyfile 2>&1',
            },
            steps: [],
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
        buildCommand: 'pnpm docs:build',
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        labels: {
          'compartment.namespace': 'compartment-e2e',
        },
        packer: 'static',
        runtimeAptPackages: ['jq'],
        staticOutputDirectory: 'public-docs/dist',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${digest}`,
      pushed: true,
    });

    const railpackInput: PrepareRailpackPlanInput | undefined = mocks.prepareRailpackPlan.mock.calls[0]?.[0];
    expect(railpackInput?.appPath).toBeUndefined();
    expect(railpackInput?.buildCommand).toBe('pnpm docs:build');
    expect(railpackInput?.runtimeAptPackages).toEqual(['jq']);
    expect(railpackInput?.staticOutputDirectory).toBe('public-docs/dist');
    expect(JSON.parse(normalizedPlanText)).toMatchObject({
      deploy: {
        inputs: [
          {
            include: ['/railpack/caddy'],
            step: 'packages:caddy',
          },
          {
            include: ['/Caddyfile'],
            step: 'caddy',
          },
          {
            include: ['public-docs/dist'],
            step: 'build',
          },
        ],
      },
    });
    expect(normalizedPlanText).toContain(
      '"startCommand": "cd /app && caddy run --config /app/Caddyfile --adapter caddyfile 2>&1"',
    );
    expect(normalizedPlanText).not.toContain('"include": [\n          "."\n        ]');
  });

  it('recovers cleanly after a failed build writes invalid metadata', async (): Promise<void> => {
    const recoveredDigest: string = testImageDigest;
    let failedMetadataDirectory: string | undefined;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.runBuildctlCommandWithOptionalProgressReporter.mockImplementationOnce(
      async (args: string[]): Promise<void> => {
        const metadataFile: string = requireBuildKitMetadataFile(args);
        failedMetadataDirectory = dirname(metadataFile);
        await writeFile(metadataFile, '{invalid', 'utf8');
        throw new Error('invalid build definition');
      },
    );

    const input: DockerBuildImageInput = {
      contextDirectory: '/tmp/source',
      imageTag: 'registry.example/compartment-web:art_123',
      packer: 'dockerfile',
    };

    await expect(buildDockerImage(input)).rejects.toThrow('invalid build definition');
    if (failedMetadataDirectory === undefined) {
      throw new Error('Expected failed build metadata directory.');
    }
    await expect(access(failedMetadataDirectory)).rejects.toThrow();

    mockBuildKitImageOutput(recoveredDigest);
    await expect(buildDockerImage(input)).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${recoveredDigest}`,
      pushed: true,
    });
  });
});

function mockBuildKitImageOutput(digest: string): void {
  mocks.runBuildctlCommandWithOptionalProgressReporter.mockImplementationOnce(async (args: string[]): Promise<void> => {
    await writeBuildKitMetadata(args, digest);
  });
}

async function writeBuildKitMetadata(args: readonly string[], digest: string): Promise<void> {
  const metadataFile: string = requireBuildKitMetadataFile(args);

  await writeFile(
    metadataFile,
    JSON.stringify({
      'containerimage.digest': digest,
    }),
    'utf8',
  );
}

function requireBuildKitMetadataFile(args: readonly string[]): string {
  const metadataFile: string | undefined = args[args.indexOf('--metadata-file') + 1];
  if (metadataFile === undefined) {
    throw new Error('Expected test BuildKit args to include --metadata-file.');
  }

  return metadataFile;
}
