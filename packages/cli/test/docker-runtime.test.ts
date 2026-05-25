import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import {
  ensureDockerExecutionContext,
  prepareSelfHostedRuntimeImages,
  restartSelfHostedSystemRuntime,
  restartSelfHostedRuntime,
  startSelfHostedRuntime,
} from '../src/docker-runtime';
import type {
  DockerExecutionContext,
  DockerExecutionMode,
  StartSelfHostedRuntimeInput,
} from '../src/docker-runtime.types';
import type { SelfHostedImageRefs } from '../src/self-hosted-env.types';

type InstallDockerEngine = (reportProgress?: ReportProgress) => Promise<void>;
type ConfirmInstallWhenMissing = () => Promise<boolean>;
type ReportProgress = (message: string) => void;
type RunCappedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunInheritedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;

interface DockerRuntimeTestMocks {
  installDockerEngine: Mock<InstallDockerEngine>;
  runCappedCommand: Mock<RunCappedCommand>;
  runCommand: Mock<RunCommand>;
  runInheritedCommand: Mock<RunInheritedCommand>;
}

type RuntimeImageServiceName = 'api' | 'caddy' | 'edge' | 'runtimeProbe' | 'worker';

interface ComposePsTestServiceEntry {
  Health: string;
  ID: string;
  Image: string;
  Publishers: [];
  Service: string;
  State: string;
}

const imageRefKeyByServiceName: Readonly<Record<RuntimeImageServiceName, keyof SelfHostedImageRefs>> = {
  api: 'apiImage',
  caddy: 'caddyImage',
  edge: 'edgeImage',
  runtimeProbe: 'runtimeProbeImage',
  worker: 'workerImage',
};
const coreSignedRuntimeServices: readonly RuntimeImageServiceName[] = [
  'api',
  'worker',
  'edge',
  'caddy',
  'runtimeProbe',
];
const mocks: DockerRuntimeTestMocks = vi.hoisted(
  (): DockerRuntimeTestMocks => ({
    installDockerEngine: vi.fn<InstallDockerEngine>(),
    runCappedCommand: vi.fn<RunCappedCommand>(),
    runCommand: vi.fn<RunCommand>(),
    runInheritedCommand: vi.fn<RunInheritedCommand>(),
  }),
);

vi.mock(
  '../src/command-runner',
  (): {
    readCommandOutput: (result: CommandResult) => string;
    runCappedCommand: Mock<RunCappedCommand>;
    runCommand: Mock<RunCommand>;
    runInheritedCommand: Mock<RunInheritedCommand>;
  } => ({
    readCommandOutput: (result: CommandResult): string =>
      [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n'),
    runCappedCommand: mocks.runCappedCommand,
    runCommand: mocks.runCommand,
    runInheritedCommand: mocks.runInheritedCommand,
  }),
);

vi.mock('../src/docker-install', (): { installDockerEngine: Mock<InstallDockerEngine> } => ({
  installDockerEngine: mocks.installDockerEngine,
}));

afterEach((): void => {
  mocks.installDockerEngine.mockReset();
  mocks.runCappedCommand.mockReset();
  mocks.runCommand.mockReset();
  mocks.runInheritedCommand.mockReset();
  delete process.env.COMPARTMENT_DOCKER_NAMESPACE;
  delete process.env.COMPARTMENT_DATABASE_URL;
});

describe('ensureDockerExecutionContext', (): void => {
  it('uses direct docker when compose and daemon access already work', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('["name=seccomp","name=rootless"]'));

    const context: DockerExecutionContext = await ensureDockerExecutionContext();

    expect(context).toEqual({
      dockerCommand: ['docker'],
      isRootlessDocker: true,
      mode: 'direct',
    });
    expectCommandCall(mocks.runCommand, ['docker', 'compose', 'version']);
    expectCommandCall(mocks.runCommand, ['docker', 'info', '--format', '{{json .SecurityOptions}}']);
    expect(mocks.runInheritedCommand).not.toHaveBeenCalled();
  });

  it('falls back to passwordless sudo when direct daemon access is unavailable', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createFailedCommandResult('permission denied', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('["name=seccomp"]'));

    const context: DockerExecutionContext = await ensureDockerExecutionContext({
      reportProgress: reportProgressMock,
    });

    expect(context).toEqual({
      dockerCommand: ['sudo', '-n', 'docker'],
      isRootlessDocker: false,
      mode: 'sudo-n',
    });
    expect(reportProgressMock).toHaveBeenCalledWith(
      'Direct Docker daemon access is unavailable. Using passwordless sudo for Docker commands.',
    );
  });

  it('falls back to interactive sudo and allows the standard password prompt', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createFailedCommandResult('permission denied', 1))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: a password is required', 1));
    mocks.runInheritedCommand.mockResolvedValueOnce(createSuccessfulCommandResult());
    mocks.runCappedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('["name=seccomp"]'));

    const context: DockerExecutionContext = await ensureDockerExecutionContext({
      allowInteractiveSudo: true,
      reportProgress: reportProgressMock,
    });

    expect(context).toEqual({
      dockerCommand: ['sudo', 'docker'],
      isRootlessDocker: false,
      mode: 'sudo',
    });
    expect(reportProgressMock).toHaveBeenCalledWith(
      'Direct Docker daemon access is unavailable. Checking Docker access via sudo; you may be prompted for your password.',
    );
    expectCommandCall(mocks.runInheritedCommand, ['sudo', '-v']);
    expectCommandCall(mocks.runCappedCommand, ['sudo', 'docker', 'compose', 'version']);
    expectCommandCall(mocks.runCappedCommand, ['sudo', 'docker', 'info', '--format', '{{json .SecurityOptions}}']);
  });

  it('fails early in non-interactive mode when daemon access would require a sudo password prompt', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createFailedCommandResult('permission denied', 1))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: a password is required', 1));

    await expect(
      ensureDockerExecutionContext({
        allowInteractiveSudo: false,
      }),
    ).rejects.toThrow(
      'Docker Engine and the Docker Compose plugin are installed, but this session cannot access the Docker daemon. Add this user to the docker group, configure passwordless sudo for Docker, or re-run `compartment install` or `compartment system update` in an interactive shell to allow `sudo docker`.',
    );
    expect(mocks.runInheritedCommand).not.toHaveBeenCalled();
  });

  it('installs Docker when it is missing and then re-runs daemon access detection', async (): Promise<void> => {
    const confirmInstallWhenMissingMock: Mock<ConfirmInstallWhenMissing> = vi
      .fn<ConfirmInstallWhenMissing>()
      .mockResolvedValue(true);
    mocks.runCommand
      .mockResolvedValueOnce(createFailedCommandResult('docker: command not found', 127))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: docker: command not found', 127))
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('["name=seccomp"]'));
    mocks.installDockerEngine.mockResolvedValueOnce();

    const context: DockerExecutionContext = await ensureDockerExecutionContext({
      confirmInstallWhenMissing: confirmInstallWhenMissingMock,
      installWhenMissing: true,
    });

    expect(confirmInstallWhenMissingMock).toHaveBeenCalledTimes(1);
    expect(mocks.installDockerEngine).toHaveBeenCalledTimes(1);
    expect(context).toEqual({
      dockerCommand: ['docker'],
      isRootlessDocker: false,
      mode: 'direct',
    });
  });

  it('fails when Docker installation is declined', async (): Promise<void> => {
    const confirmInstallWhenMissingMock: Mock<ConfirmInstallWhenMissing> = vi
      .fn<ConfirmInstallWhenMissing>()
      .mockResolvedValue(false);
    mocks.runCommand
      .mockResolvedValueOnce(createFailedCommandResult('docker: command not found', 127))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: docker: command not found', 127));

    await expect(
      ensureDockerExecutionContext({
        confirmInstallWhenMissing: confirmInstallWhenMissingMock,
        installWhenMissing: true,
      }),
    ).rejects.toThrow(
      'Docker installation was skipped. Install Docker manually and re-run `compartment install` or `compartment system update`.',
    );
    expect(mocks.installDockerEngine).not.toHaveBeenCalled();
  });

  it('fails with an approval message when Docker install cannot be confirmed', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(createFailedCommandResult('docker: command not found', 127))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: docker: command not found', 127));

    await expect(
      ensureDockerExecutionContext({
        installWhenMissing: true,
      }),
    ).rejects.toThrow(
      'Docker Engine with the Docker Compose plugin is required before self-hosted runtime management. Install Docker manually, or re-run `compartment install` or `compartment system update` in an interactive shell to approve Docker installation.',
    );
    expect(mocks.installDockerEngine).not.toHaveBeenCalled();
  });

  it('reports the sudo check and installs Docker when interactive sudo finds the command missing', async (): Promise<void> => {
    const confirmInstallWhenMissingMock: Mock<ConfirmInstallWhenMissing> = vi
      .fn<ConfirmInstallWhenMissing>()
      .mockResolvedValue(true);
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runCommand
      .mockResolvedValueOnce(createFailedCommandResult('docker: command not found', 127))
      .mockResolvedValueOnce(createFailedCommandResult('sudo: a password is required', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('not-json'));
    mocks.runInheritedCommand.mockResolvedValueOnce(createSuccessfulCommandResult());
    mocks.runCappedCommand.mockResolvedValueOnce(createFailedCommandResult('sudo: docker: command not found', 127));
    mocks.installDockerEngine.mockImplementationOnce(async (reportProgress?: ReportProgress): Promise<void> => {
      reportProgress?.('Docker installation is continuing after sudo access was confirmed.');
      await Promise.resolve();
    });

    const context: DockerExecutionContext = await ensureDockerExecutionContext({
      allowInteractiveSudo: true,
      confirmInstallWhenMissing: confirmInstallWhenMissingMock,
      installWhenMissing: true,
      reportProgress: reportProgressMock,
    });

    expect(confirmInstallWhenMissingMock).toHaveBeenCalledTimes(1);
    expect(reportProgressMock).toHaveBeenCalledWith(
      'Direct Docker access is unavailable. Checking Docker access via sudo; you may be prompted for your password.',
    );
    expect(reportProgressMock).toHaveBeenCalledWith(
      'Docker installation is continuing after sudo access was confirmed.',
    );
    expect(context).toEqual({
      dockerCommand: ['docker'],
      isRootlessDocker: false,
      mode: 'direct',
    });
  });

  it('defaults rootless detection to false when docker info security options cannot be parsed', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('Docker Compose version v2.33.0'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('not-json'));

    const context: DockerExecutionContext = await ensureDockerExecutionContext();

    expect(context).toEqual({
      dockerCommand: ['docker'],
      isRootlessDocker: false,
      mode: 'direct',
    });
  });
});

describe('prepareSelfHostedRuntimeImages', (): void => {
  it('checks the runtime probe image without pulling when install explicitly selects local images', async (): Promise<void> => {
    const imageRefs: SelfHostedImageRefs = createImageRefs();
    mocks.runInheritedCommand.mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'));

    await prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
      composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
      envPath: '/tmp/compartment/.env.self-hosted',
      imageRefs,
      imageSource: 'local',
      installDirectory: '/tmp/compartment',
      localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
    });

    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'image', 'inspect', imageRefs.runtimeProbeImage]);
    expect(readDockerPullCommands(mocks.runInheritedCommand)).toHaveLength(0);
  });

  it('fails local image preparation when the runtime probe image is missing', async (): Promise<void> => {
    const imageRefs: SelfHostedImageRefs = createImageRefs();
    mocks.runInheritedCommand.mockResolvedValueOnce(createFailedCommandResult('runtime probe image missing', 1));

    await expect(
      prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
        composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
        envPath: '/tmp/compartment/.env.self-hosted',
        imageRefs,
        imageSource: 'local',
        installDirectory: '/tmp/compartment',
        localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
      }),
    ).rejects.toThrow(
      `Expected local runtime probe image ${imageRefs.runtimeProbeImage} before runtime start.\nruntime probe image missing`,
    );
  });

  it.each(['latest', 'main'] as const)(
    'fails fast when verified image pull fails for mutable registry tag %s',
    async (tag: string): Promise<void> => {
      const imageRefs: SelfHostedImageRefs = createImageRefs(tag);
      mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('verified'));
      mocks.runCappedCommand.mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
      mocks.runInheritedCommand.mockResolvedValueOnce(createFailedCommandResult('pull failed', 1));

      await expect(
        prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
          composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
          envPath: '/tmp/compartment/.env.self-hosted',
          imageRefs,
          imageSource: 'registry',
          installDirectory: '/tmp/compartment',
          localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
        }),
      ).rejects.toThrow('Failed to pull self-hosted images.\npull failed');

      expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'pull', readImageDigestRef(imageRefs, 'api')]);
      expect(readImageInspectCommands(mocks.runInheritedCommand)).toHaveLength(0);
    },
  );

  it('allows pinned registry images to reuse local images when verified pull fails', async (): Promise<void> => {
    const imageRefs: SelfHostedImageRefs = createImageRefs('0.2.0');
    mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('verified'));
    mocks.runCappedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'api')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'worker')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'edge')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'caddy')])))
      .mockResolvedValueOnce(
        createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'runtimeProbe')])),
      )
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'worker')])));
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createFailedCommandResult('pull failed', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult('api image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('caddy image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('edge image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('postgres image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('builder image pulled'));

    await expect(
      prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
        composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
        envPath: '/tmp/compartment/.env.self-hosted',
        imageRefs,
        imageSource: 'registry',
        installDirectory: '/tmp/compartment',
        localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
      }),
    ).resolves.toBeUndefined();

    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'image', 'inspect', imageRefs.edgeImage]);
    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'image', 'inspect', 'postgres:16']);
    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'pull', readImageDigestRef(imageRefs, 'worker')]);
  });

  it('reports optional build image pull failures without blocking the core runtime', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    const imageRefs: SelfHostedImageRefs = createImageRefs('0.2.0');
    mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('verified'));
    mocks.runCappedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'api')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'worker')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'edge')])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'caddy')])))
      .mockResolvedValueOnce(
        createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, 'runtimeProbe')])),
      )
      .mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('api image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('api image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('edge image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('edge image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('caddy image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('caddy image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image tagged'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('postgres image pulled'))
      .mockResolvedValueOnce(createFailedCommandResult('worker pull failed', 1));

    await expect(
      prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
        composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
        envPath: '/tmp/compartment/.env.self-hosted',
        imageRefs,
        imageSource: 'registry',
        installDirectory: '/tmp/compartment',
        localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
        reportProgress: reportProgressMock,
      }),
    ).resolves.toBeUndefined();

    expect(reportProgressMock).toHaveBeenCalledWith(
      'Build worker images could not be pulled. The control plane can still start; source builds may stay unavailable until builder and worker images are available.\nworker pull failed',
    );
  });

  it('checks the postgres image when verified pull fails for pinned registry install', async (): Promise<void> => {
    const imageRefs: SelfHostedImageRefs = createImageRefs('0.2.0');
    mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('verified'));
    mocks.runCappedCommand.mockResolvedValueOnce(createSuccessfulCommandResult(`sha256:${'a'.repeat(64)}`));
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createFailedCommandResult('pull failed', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult('api image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('caddy image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('edge image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('worker image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image present'))
      .mockResolvedValueOnce(createFailedCommandResult('postgres missing', 1));

    await expect(
      prepareSelfHostedRuntimeImages(createDockerExecutionContext('sudo'), {
        composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
        envPath: '/tmp/compartment/.env.self-hosted',
        imageRefs,
        imageSource: 'registry',
        installDirectory: '/tmp/compartment',
        localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
      }),
    ).rejects.toThrow('Failed to pull self-hosted images.\npull failed');

    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'pull', readImageDigestRef(imageRefs, 'api')]);
    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'image', 'inspect', 'postgres:16']);
  });
});

describe('startSelfHostedRuntime', (): void => {
  it('uses the selected interactive sudo mode for compose up', async (): Promise<void> => {
    process.env.COMPARTMENT_DOCKER_NAMESPACE = 'compartment-local';
    process.env.COMPARTMENT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev';
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult());

    await startSelfHostedRuntime(createDockerExecutionContext('sudo'), createRuntimeInput('local'));

    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'image',
      'inspect',
      createImageRefs().runtimeProbeImage,
    ]);
    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.local.yml',
      'up',
      '-d',
      '--wait',
      'api',
      'registry',
      'registry-auth',
      'edge',
      'caddy',
    ]);
    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.local.yml',
      'up',
      '-d',
      '--wait',
      'builder',
      'worker',
    ]);
  });

  it('keeps the control plane start successful when builder services fail', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createFailedCommandResult('builder unhealthy', 1));
    mockCoreAndBuildLocalImageSignatureVerifications(createImageRefs());
    mockHealthyCoreRuntimeInspection();

    await expect(
      startSelfHostedRuntime(createDockerExecutionContext('sudo'), {
        ...createRuntimeInput('registry'),
        reportProgress: reportProgressMock,
      }),
    ).resolves.toBeUndefined();

    expect(reportProgressMock).toHaveBeenCalledWith(
      'Build worker services did not become healthy. The control plane remains running; source builds will stay unavailable until the builder starts.\nbuilder unhealthy',
    );
  });

  it('continues when compose reports a transient core start error after services become available', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createFailedCommandResult('Error response from daemon: No such container: api-migrate', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult());
    mockHealthyRuntimeInspection(['api', 'registry', 'registry-auth', 'edge', 'caddy']);

    await expect(
      startSelfHostedRuntime(createDockerExecutionContext('sudo'), {
        ...createRuntimeInput('local'),
        reportProgress: reportProgressMock,
      }),
    ).resolves.toBeUndefined();

    expect(reportProgressMock).toHaveBeenCalledWith(
      'Docker Compose reported a transient start error after required services became available.',
    );
  });

  it('continues when compose reports a transient build start error after services become available', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createFailedCommandResult('Error response from daemon: No such container: builder', 1));
    mockHealthyRuntimeInspection(['builder', 'worker']);

    await expect(
      startSelfHostedRuntime(createDockerExecutionContext('sudo'), {
        ...createRuntimeInput('local'),
        reportProgress: reportProgressMock,
      }),
    ).resolves.toBeUndefined();

    expect(reportProgressMock).toHaveBeenCalledWith(
      'Docker Compose reported a transient build-service start error after services became available.',
    );
  });

  it('fails builder service start errors when the core runtime cannot be verified', async (): Promise<void> => {
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createFailedCommandResult('compose file invalid', 1));
    mockCoreAndBuildLocalImageSignatureVerifications(createImageRefs());
    mocks.runCappedCommand.mockResolvedValueOnce(createSuccessfulCommandResult('[]'));

    await expect(
      startSelfHostedRuntime(createDockerExecutionContext('sudo'), {
        ...createRuntimeInput('registry'),
      }),
    ).rejects.toThrow('Failed to start self-hosted build worker services.\ncompose file invalid');
  });
});

describe('restartSelfHostedRuntime', (): void => {
  it('restarts services with orphan removal and force recreate', async (): Promise<void> => {
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('postgres image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult('builder image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult());
    mockCoreAndBuildLocalImageSignatureVerifications(createImageRefs());

    await restartSelfHostedRuntime(createDockerExecutionContext('sudo'), createRuntimeInput('registry'));

    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      'up',
      '-d',
      '--wait',
      '--pull',
      'never',
      '--remove-orphans',
      '--force-recreate',
      'api',
      'registry',
      'registry-auth',
      'edge',
      'caddy',
    ]);
    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      'up',
      '-d',
      '--wait',
      '--pull',
      'never',
      '--remove-orphans',
      '--force-recreate',
      'builder',
      'worker',
    ]);
  });

  it('pulls missing fixed dependency images before registry restart', async (): Promise<void> => {
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image present'))
      .mockResolvedValueOnce(createFailedCommandResult('postgres missing', 1))
      .mockResolvedValueOnce(createSuccessfulCommandResult('postgres image pulled'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult('builder image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult());
    mockCoreAndBuildLocalImageSignatureVerifications(createImageRefs());

    await restartSelfHostedRuntime(createDockerExecutionContext('sudo'), createRuntimeInput('registry'));

    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'image', 'inspect', 'postgres:16']);
    expectCommandCall(mocks.runInheritedCommand, ['sudo', 'docker', 'pull', 'postgres:16']);
  });

  it('keeps the control plane restart successful when builder services fail', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('registry image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult('postgres image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult('builder image present'))
      .mockResolvedValueOnce(createFailedCommandResult('builder unhealthy', 1));
    mockCoreAndBuildLocalImageSignatureVerifications(createImageRefs());
    mockHealthyCoreRuntimeInspection();

    await expect(
      restartSelfHostedRuntime(createDockerExecutionContext('sudo'), {
        ...createRuntimeInput('registry'),
        reportProgress: reportProgressMock,
      }),
    ).resolves.toBeUndefined();

    expect(reportProgressMock).toHaveBeenCalledWith(
      'Build worker services did not become healthy. The control plane remains running; source builds will stay unavailable until the builder starts.\nbuilder unhealthy',
    );
  });
});

describe('restartSelfHostedSystemRuntime', (): void => {
  it('restarts the full steady-state stack including postgres', async (): Promise<void> => {
    mocks.runInheritedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult('runtime probe image present'))
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult());

    await restartSelfHostedSystemRuntime(createDockerExecutionContext('sudo'), createRuntimeInput('local'));

    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'image',
      'inspect',
      createImageRefs().runtimeProbeImage,
    ]);
    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.local.yml',
      'up',
      '-d',
      '--wait',
      '--remove-orphans',
      '--force-recreate',
      'api',
      'registry',
      'registry-auth',
      'edge',
      'caddy',
      'postgres',
    ]);
    expectCommandCall(mocks.runInheritedCommand, [
      'sudo',
      'docker',
      'compose',
      '--project-directory',
      '/tmp/compartment',
      '--env-file',
      '/tmp/compartment/.env.self-hosted',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.yml',
      '-f',
      '/tmp/compartment/docker-compose.self-hosted.local.yml',
      'up',
      '-d',
      '--wait',
      '--remove-orphans',
      '--force-recreate',
      'builder',
      'worker',
    ]);
  });
});

function createSuccessfulCommandResult(stdout: string = ''): CommandResult {
  return {
    exitCode: 0,
    stderr: '',
    stdout,
  };
}

function createFailedCommandResult(stderr: string, exitCode: number): CommandResult {
  return {
    exitCode,
    stderr,
    stdout: '',
  };
}

function createDockerExecutionContext(mode: DockerExecutionMode): DockerExecutionContext {
  if (mode === 'direct') {
    return { dockerCommand: ['docker'], isRootlessDocker: false, mode };
  }

  if (mode === 'sudo-n') {
    return { dockerCommand: ['sudo', '-n', 'docker'], isRootlessDocker: false, mode };
  }

  return { dockerCommand: ['sudo', 'docker'], isRootlessDocker: false, mode };
}

function expectCommandCall(mock: Mock<RunCommand | RunInheritedCommand>, expectedCommand: readonly string[]): void {
  expect(readCommandCalls(mock)).toContainEqual(expectedCommand);
}

function readCommandCalls(mock: Mock<RunCommand | RunInheritedCommand>): readonly (readonly string[])[] {
  return mock.mock.calls.map(
    (call: [command: readonly string[], env?: NodeJS.ProcessEnv | undefined]): readonly string[] => call[0],
  );
}

function readImageInspectCommands(mock: Mock<RunCommand | RunInheritedCommand>): readonly (readonly string[])[] {
  return readCommandCalls(mock).filter(isImageInspectCommand);
}

function readDockerPullCommands(mock: Mock<RunCommand | RunInheritedCommand>): readonly (readonly string[])[] {
  return readCommandCalls(mock).filter(isDockerPullCommand);
}

function isImageInspectCommand(command: readonly string[]): boolean {
  return command.length >= 4 && command[command.length - 2] === 'inspect' && command[command.length - 3] === 'image';
}

function isDockerPullCommand(command: readonly string[]): boolean {
  return command.length >= 3 && command[command.length - 3] === 'docker' && command[command.length - 2] === 'pull';
}

function createImageRefs(tag: string = 'latest'): SelfHostedImageRefs {
  return {
    apiImage: `ghcr.io/compartmentdev/compartment-api:${tag}`,
    caddyImage: `ghcr.io/compartmentdev/compartment-caddy:${tag}`,
    edgeImage: `ghcr.io/compartmentdev/compartment-edge:${tag}`,
    runtimeProbeImage: `ghcr.io/compartmentdev/compartment-runtime-probe:${tag}`,
    workerImage: `ghcr.io/compartmentdev/compartment-worker:${tag}`,
  };
}

function createRuntimeInput(imageSource: 'local' | 'registry'): StartSelfHostedRuntimeInput {
  return {
    composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
    envPath: '/tmp/compartment/.env.self-hosted',
    imageRefs: createImageRefs(),
    imageSource,
    installDirectory: '/tmp/compartment',
    localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
  };
}

function mockLocalImageSignatureVerifications(
  imageRefs: SelfHostedImageRefs,
  services: readonly RuntimeImageServiceName[],
): void {
  mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('verified'));

  for (const serviceName of services) {
    mocks.runCappedCommand.mockResolvedValueOnce(
      createSuccessfulCommandResult(JSON.stringify([readImageDigestRef(imageRefs, serviceName)])),
    );
  }
}

function mockCoreAndBuildLocalImageSignatureVerifications(imageRefs: SelfHostedImageRefs): void {
  mockLocalImageSignatureVerifications(imageRefs, coreSignedRuntimeServices);
  mockLocalImageSignatureVerifications(imageRefs, ['worker']);
}

function readImageDigestRef(imageRefs: SelfHostedImageRefs, serviceName: RuntimeImageServiceName): string {
  const imageRef: string = imageRefs[imageRefKeyByServiceName[serviceName]];
  return `${imageRef.slice(0, imageRef.lastIndexOf(':'))}@sha256:${'a'.repeat(64)}`;
}

function mockHealthyCoreRuntimeInspection(): void {
  mockHealthyRuntimeInspection(['api', 'registry', 'registry-auth', 'edge', 'caddy']);
}

function mockHealthyRuntimeInspection(serviceNames: readonly string[]): void {
  mocks.runCommand.mockResolvedValue(createSuccessfulCommandResult('active'));
  mocks.runCappedCommand
    .mockResolvedValueOnce(
      createSuccessfulCommandResult(
        JSON.stringify(
          serviceNames.map(
            (serviceName: string): ComposePsTestServiceEntry => ({
              Health: 'healthy',
              ID: `container_${serviceName}`,
              Image: `ghcr.io/compartmentdev/compartment-${serviceName}:0.2.0`,
              Publishers: [],
              Service: serviceName,
              State: 'running',
            }),
          ),
        ),
      ),
    )
    .mockResolvedValue(createSuccessfulCommandResult(createHealthyContainerInspectOutput()));
}

function createHealthyContainerInspectOutput(): string {
  return JSON.stringify([
    {
      Config: { Image: 'ghcr.io/compartmentdev/compartment-runtime:0.2.0' },
      NetworkSettings: { Ports: {} },
      State: {
        Health: { Status: 'healthy' },
        StartedAt: '2026-04-09T11:00:00.000Z',
        Status: 'running',
      },
    },
  ]);
}
