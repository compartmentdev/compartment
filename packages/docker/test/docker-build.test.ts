import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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

const testImageManifestDigest: string = `sha256:${'e'.repeat(64)}`;

interface RegistryAttestationFixture {
  attestationManifest: string;
  index: string;
  indexDigest: string;
  statement: string;
}

const defaultRegistryAttestation: RegistryAttestationFixture = buildRegistryAttestation(testImageManifestDigest);
const testIndexDigest: string = defaultRegistryAttestation.indexDigest;

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
  stubSpdxRegistryAttestation();
});

afterEach((): void => {
  delete process.env.BUILDKIT_ADDR;
  vi.unstubAllGlobals();
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

  it('builds and pushes a dockerfile image through remote BuildKit', async (): Promise<void> => {
    const digest: string = testIndexDigest;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    stubSpdxRegistryAttestation(testImageManifestDigest, 'registry:5000');
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        buildEnv: {
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
        },
        cacheImageRef: 'registry:5000/compartment-web:build-cache',
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
  });

  it('exports the registry cache in bounded mode', (): void => {
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

    expect(args).toContain(
      'type=registry,ref=registry:5000/compartment-web:build-cache,mode=min,image-manifest=true,oci-mediatypes=true,registry.insecure=true',
    );
  });

  it('refuses to send push credentials to a different registry host during SBOM verification', async (): Promise<void> => {
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(testIndexDigest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
        pushRegistryCredentials: {
          password: 'registry-password',
          serverAddress: 'other-registry.example',
          username: 'registry-user',
        },
      }),
    ).rejects.toThrow('registry credentials do not match the target registry');
  });

  it('resolves the default Dockerfile path against the remote BuildKit context', async (): Promise<void> => {
    const digest: string = testIndexDigest;

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
    const digest: string = testIndexDigest;
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
    const digest: string = testIndexDigest;

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
        '--opt',
        'attest:sbom=',
        '--output',
        'type=image,name=registry:5000/compartment-web:art_123,push=true,oci-mediatypes=true,oci-artifact=true,registry.insecure=true',
      ]),
    );
  });

  it('passes Railpack apt package env values as BuildKit secrets for the generated plan', async (): Promise<void> => {
    const digest: string = testIndexDigest;

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
    const digest: string = testIndexDigest;
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
    expect(normalizedPlanText).not.toContain('"include": [\n          "."\n        ]');
  });

  it('recovers cleanly after a failed build writes invalid metadata', async (): Promise<void> => {
    const recoveredDigest: string = testIndexDigest;

    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mocks.runBuildctlCommandWithOptionalProgressReporter.mockImplementationOnce(
      async (args: string[]): Promise<void> => {
        const metadataFile: string = requireBuildKitMetadataFile(args);
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

    mockBuildKitImageOutput(recoveredDigest);
    await expect(buildDockerImage(input)).resolves.toEqual({
      imageRef: `registry.example/compartment-web@${recoveredDigest}`,
      pushed: true,
    });
  });

  it('rejects registry bytes that do not match the pushed image digest', async (): Promise<void> => {
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(`sha256:${'7'.repeat(64)}`);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('registry content digest mismatch');
  });

  it('fails a pushed build when the registry image has no SPDX attestation', async (): Promise<void> => {
    const index: string = JSON.stringify({ manifests: [], mediaType: 'application/vnd.oci.image.index.v1+json' });
    const digest: string = registryDigest(index);
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response(index, { status: 200 })),
    );

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('include an SPDX SBOM attestation');
  });

  it('rejects a registry response that exceeds the verification size limit', async (): Promise<void> => {
    const oversizedIndex: string = JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) });
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(registryDigest(oversizedIndex));
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response(oversizedIndex, { status: 200 })),
    );

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('registry response exceeds the size limit');
  });

  it('reads SBOM manifests and blobs through literal digest paths', async (): Promise<void> => {
    const requestedUrls: string[] = [];
    const digest: string = stubSpdxRegistryAttestation(testImageManifestDigest, undefined, requestedUrls);
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).resolves.toMatchObject({ pushed: true });

    const digestReadPaths: string[] = requestedUrls
      .map((url: string): string => new URL(url).pathname)
      .filter((path: string): boolean => path.includes('/manifests/') || path.includes('/blobs/'));
    expect(digestReadPaths.length).toBeGreaterThan(0);
    expect(digestReadPaths.every((path: string): boolean => path.includes('/sha256:') && !path.includes('%'))).toBe(
      true,
    );
  });

  it('rejects an SPDX attestation whose payload does not bind to the pushed image', async (): Promise<void> => {
    const digest: string = stubSpdxRegistryAttestation(`sha256:${'0'.repeat(64)}`);
    process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
    mockBuildKitImageOutput(digest);

    await expect(
      buildDockerImage({
        contextDirectory: '/tmp/source',
        imageTag: 'registry.example/compartment-web:art_123',
        packer: 'dockerfile',
      }),
    ).rejects.toThrow('include an SPDX SBOM attestation');
  });
});

function stubSpdxRegistryAttestation(
  statementSubjectDigest: string = testImageManifestDigest,
  requiredRegistryHost?: string,
  requestedUrls?: string[],
): string {
  const fixture: RegistryAttestationFixture = buildRegistryAttestation(statementSubjectDigest);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit): Response => {
      const url: string = input instanceof Request ? input.url : String(input);
      requestedUrls?.push(url);
      if (requiredRegistryHost !== undefined && new URL(url).host !== requiredRegistryHost) {
        return new Response(undefined, { status: 404 });
      }
      const accept: string | null = new Headers(init?.headers).get('Accept');
      if (accept === 'application/vnd.oci.image.index.v1+json') {
        return new Response(fixture.index, { status: 200 });
      }
      if (url.includes('/blobs/')) {
        return new Response(fixture.statement, { status: 200 });
      }
      return new Response(fixture.attestationManifest, { status: 200 });
    }),
  );
  return fixture.indexDigest;
}

function buildRegistryAttestation(statementSubjectDigest: string): RegistryAttestationFixture {
  const separator: number = statementSubjectDigest.indexOf(':');
  const statement: string = JSON.stringify({
    _type: 'https://in-toto.io/Statement/v0.1',
    predicate: { SPDXID: 'SPDXRef-DOCUMENT', spdxVersion: 'SPDX-2.3' },
    predicateType: 'https://spdx.dev/Document',
    subject: [
      { digest: { [statementSubjectDigest.slice(0, separator)]: statementSubjectDigest.slice(separator + 1) } },
    ],
  });
  const attestationManifest: string = JSON.stringify({
    layers: [
      {
        annotations: { 'in-toto.io/predicate-type': 'https://spdx.dev/Document' },
        digest: registryDigest(statement),
        mediaType: 'application/vnd.in-toto+json',
      },
    ],
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
  });
  const index: string = JSON.stringify({
    manifests: [
      { digest: testImageManifestDigest, mediaType: 'application/vnd.oci.image.manifest.v1+json' },
      {
        annotations: {
          'vnd.docker.reference.digest': testImageManifestDigest,
          'vnd.docker.reference.type': 'attestation-manifest',
        },
        digest: registryDigest(attestationManifest),
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
      },
    ],
    mediaType: 'application/vnd.oci.image.index.v1+json',
  });
  return { attestationManifest, index, indexDigest: registryDigest(index), statement };
}

function registryDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

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
