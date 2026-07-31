import { selfHostedRuntimeImageSignaturePolicy } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import {
  pullVerifiedRemoteSelfHostedRuntimeImages,
  verifyLocalSelfHostedRuntimeImageSignatures,
} from '../src/docker-runtime-signature';
import type { DockerExecutionContext } from '../src/docker-runtime.types';
import type { SelfHostedImageRefs } from '../src/self-hosted-env.types';

type RunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunDockerCommand = (context: DockerExecutionContext, args: readonly string[]) => Promise<CommandResult>;
type RunQuietDockerCommand = (context: DockerExecutionContext, args: readonly string[]) => Promise<CommandResult>;
type ReadCosignCommand = () => Promise<readonly string[]>;

interface DockerRuntimeSignatureTestMocks {
  readCosignCommand: Mock<ReadCosignCommand>;
  runCommand: Mock<RunCommand>;
  runDockerCommand: Mock<RunDockerCommand>;
  runQuietDockerCommand: Mock<RunQuietDockerCommand>;
}

const mocks: DockerRuntimeSignatureTestMocks = vi.hoisted(
  (): DockerRuntimeSignatureTestMocks => ({
    readCosignCommand: vi.fn<ReadCosignCommand>(),
    runCommand: vi.fn<RunCommand>(),
    runDockerCommand: vi.fn<RunDockerCommand>(),
    runQuietDockerCommand: vi.fn<RunQuietDockerCommand>(),
  }),
);

vi.mock(
  '../src/bundled-cosign',
  (): {
    readCosignCommand: Mock<ReadCosignCommand>;
  } => ({
    readCosignCommand: mocks.readCosignCommand,
  }),
);

vi.mock(
  '../src/command-runner',
  (): {
    readCommandOutput: (result: CommandResult) => string;
    runCommand: Mock<RunCommand>;
  } => ({
    readCommandOutput: (result: CommandResult): string =>
      [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n'),
    runCommand: mocks.runCommand,
  }),
);

vi.mock(
  '../src/docker-command',
  (): {
    runDockerCommand: Mock<RunDockerCommand>;
    runQuietDockerCommand: Mock<RunQuietDockerCommand>;
  } => ({
    runDockerCommand: mocks.runDockerCommand,
    runQuietDockerCommand: mocks.runQuietDockerCommand,
  }),
);

beforeEach((): void => {
  mocks.readCosignCommand.mockResolvedValue(['/embedded/cosign']);
});

afterEach((): void => {
  mocks.readCosignCommand.mockReset();
  mocks.runCommand.mockReset();
  mocks.runDockerCommand.mockReset();
  mocks.runQuietDockerCommand.mockReset();
  delete process.env.NON_COMPARTMENT_ENV;
  delete process.env.COMPARTMENT_SYSTEM_TOKEN;
});

describe('runtime image signature verification', (): void => {
  it('verifies the remote builder digest signature before Docker pulls the image', async (): Promise<void> => {
    process.env.COMPARTMENT_SYSTEM_TOKEN = 'secret-token';
    process.env.NON_COMPARTMENT_ENV = 'kept';
    mocks.runQuietDockerCommand.mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
    mocks.runCommand.mockResolvedValueOnce(createSuccessfulCommandResult('verified'));
    mocks.runDockerCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('tagged'));

    await expect(
      pullVerifiedRemoteSelfHostedRuntimeImages({
        context: createDockerExecutionContext(),
        imageRefs: createImageRefs('0.2.0'),
        services: ['builder'],
      }),
    ).resolves.toBeNull();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      [
        '/embedded/cosign',
        'verify',
        selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
        '--certificate-oidc-issuer',
        selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
        '--certificate-identity-regexp',
        selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
        `ghcr.io/compartmentdev/compartment-builder@sha256:${'a'.repeat(64)}`,
      ],
      expect.objectContaining({
        NON_COMPARTMENT_ENV: 'kept',
      }),
    );
    expect(mocks.runCommand.mock.calls[0]?.[1]?.COMPARTMENT_SYSTEM_TOKEN).toBeUndefined();
    expect(mocks.runCommand.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runDockerCommand.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not apply the Compartment signature policy to the legacy third-party builder image', async (): Promise<void> => {
    const imageRefs: SelfHostedImageRefs = createImageRefs('0.2.0');
    imageRefs.builderImage = 'moby/buildkit:v0.30.0';

    await expect(
      verifyLocalSelfHostedRuntimeImageSignatures({
        context: createDockerExecutionContext(),
        imageRefs,
        services: ['builder'],
      }),
    ).resolves.toBeUndefined();

    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('does not pull a remote image when signature verification fails', async (): Promise<void> => {
    mocks.runQuietDockerCommand.mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
    mocks.runCommand.mockResolvedValueOnce({
      exitCode: 1,
      stderr: 'no matching certificate identity',
      stdout: '',
    });

    await expect(
      pullVerifiedRemoteSelfHostedRuntimeImages({
        context: createDockerExecutionContext(),
        imageRefs: createImageRefs('0.2.0'),
        services: ['api'],
      }),
    ).rejects.toThrow(
      `Failed to verify self-hosted image signature for ghcr.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}.`,
    );

    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it('verifies Docker Hub remote digest refs when Docker Hub is selected', async (): Promise<void> => {
    mocks.runQuietDockerCommand.mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
    mocks.runCommand.mockResolvedValueOnce(createSuccessfulCommandResult('verified'));
    mocks.runDockerCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('tagged'));

    await expect(
      pullVerifiedRemoteSelfHostedRuntimeImages({
        context: createDockerExecutionContext(),
        imageRefs: createDockerHubImageRefs('0.2.0'),
        services: ['api'],
      }),
    ).resolves.toBeNull();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.arrayContaining([`docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`]),
      expect.any(Object),
    );
    expect(mocks.runDockerCommand).toHaveBeenCalledWith(createDockerExecutionContext(), [
      'pull',
      `docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`,
    ]);
  });

  it('verifies the pulled local digest before containers start', async (): Promise<void> => {
    process.env.COMPARTMENT_SYSTEM_TOKEN = 'secret-token';
    mocks.runQuietDockerCommand.mockResolvedValueOnce(
      createSuccessfulCommandResult(
        JSON.stringify([`ghcr.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`]),
      ),
    );
    mocks.runCommand.mockResolvedValueOnce(createSuccessfulCommandResult('verified'));

    await expect(
      verifyLocalSelfHostedRuntimeImageSignatures({
        context: createDockerExecutionContext(),
        imageRefs: createImageRefs('0.2.0'),
        services: ['api'],
      }),
    ).resolves.toBeUndefined();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      [
        '/embedded/cosign',
        'verify',
        selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
        '--certificate-oidc-issuer',
        selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
        '--certificate-identity-regexp',
        selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
        `ghcr.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`,
      ],
      expect.not.objectContaining({
        COMPARTMENT_SYSTEM_TOKEN: 'secret-token',
      }),
    );
  });

  it('matches Docker Hub local digests when Docker omits the docker.io host', async (): Promise<void> => {
    mocks.runQuietDockerCommand.mockResolvedValueOnce(
      createSuccessfulCommandResult(JSON.stringify([`compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`])),
    );
    mocks.runCommand.mockResolvedValueOnce(createSuccessfulCommandResult('verified'));

    await expect(
      verifyLocalSelfHostedRuntimeImageSignatures({
        context: createDockerExecutionContext(),
        imageRefs: createDockerHubImageRefs('0.2.0'),
        services: ['api'],
      }),
    ).resolves.toBeUndefined();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      [
        '/embedded/cosign',
        'verify',
        selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
        '--certificate-oidc-issuer',
        selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
        '--certificate-identity-regexp',
        selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
        `docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`,
      ],
      expect.any(Object),
    );
  });

  it('matches Docker Hub local digests when Docker uses the index.docker.io host', async (): Promise<void> => {
    mocks.runQuietDockerCommand.mockResolvedValueOnce(
      createSuccessfulCommandResult(
        JSON.stringify([`index.docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`]),
      ),
    );
    mocks.runCommand.mockResolvedValueOnce(createSuccessfulCommandResult('verified'));

    await expect(
      verifyLocalSelfHostedRuntimeImageSignatures({
        context: createDockerExecutionContext(),
        imageRefs: createDockerHubImageRefs('0.2.0'),
        services: ['api'],
      }),
    ).resolves.toBeUndefined();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      [
        '/embedded/cosign',
        'verify',
        selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
        '--certificate-oidc-issuer',
        selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
        '--certificate-identity-regexp',
        selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
        `docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`,
      ],
      expect.any(Object),
    );
  });
});

function createSuccessfulCommandResult(stdout: string = ''): CommandResult {
  return {
    exitCode: 0,
    stderr: '',
    stdout,
  };
}

function createImageRefs(tag: string): SelfHostedImageRefs {
  return {
    apiImage: `ghcr.io/compartmentdev/compartment-api:${tag}`,
    builderImage: `ghcr.io/compartmentdev/compartment-builder:${tag}`,
    caddyImage: `ghcr.io/compartmentdev/compartment-caddy:${tag}`,
    edgeImage: `ghcr.io/compartmentdev/compartment-edge:${tag}`,
    runtimeProbeImage: `ghcr.io/compartmentdev/compartment-runtime-probe:${tag}`,
    workerImage: `ghcr.io/compartmentdev/compartment-worker:${tag}`,
  };
}

function createDockerHubImageRefs(tag: string): SelfHostedImageRefs {
  return {
    apiImage: `docker.io/compartmentdev/compartment-api:${tag}`,
    builderImage: `docker.io/compartmentdev/compartment-builder:${tag}`,
    caddyImage: `docker.io/compartmentdev/compartment-caddy:${tag}`,
    edgeImage: `docker.io/compartmentdev/compartment-edge:${tag}`,
    runtimeProbeImage: `docker.io/compartmentdev/compartment-runtime-probe:${tag}`,
    workerImage: `docker.io/compartmentdev/compartment-worker:${tag}`,
  };
}

function createDockerExecutionContext(): DockerExecutionContext {
  return {
    dockerCommand: ['docker'],
    isRootlessDocker: false,
    mode: 'direct',
  };
}
