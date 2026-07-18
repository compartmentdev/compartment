import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const defaultPath: string = process.env.PATH ?? '/usr/bin:/bin';
const execFile: (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv | undefined;
  },
) => Promise<ExecFileSuccess> = promisify(execFileCallback);
const expectedArtifactName: string = 'compartment-linux-x64.tar.gz';
const expectedInstalledVersion: string = '0.1.0-main+1234567';
const expectedMainCommitSha: string = '1234567890abcdef1234567890abcdef12345678';
const expectedMainReleaseTag: string = `sha-${expectedMainCommitSha}`;
const repositoryRoot: string = resolve(__dirname, '../../..');
const renderInstallerScriptPath: string = resolve(repositoryRoot, 'scripts/release/render-cli-install-script.mjs');
const sourceInstallerScriptPath: string = resolve(repositoryRoot, 'install.sh');
const temporaryDirectories: string[] = [];

interface InstallerFixture {
  artifactName: string;
  checksumsPath: string;
  tarballPath: string;
}

interface InstallerScriptResult {
  exitCode: number | string;
  installerTerminalOutput: string;
  stderr: string;
  stdout: string;
  compartmentInvocations: string[];
  sudoInvocations: string[];
  urlLog: string[];
}

interface InstallerRunOptions {
  acceptPathUpdate?: boolean | undefined;
  allowFailure?: boolean | undefined;
  args: string[];
  binDir?: string | undefined;
  defaultVersion?: string | undefined;
  installerTerminalPath?: string | undefined;
  osName?: string | undefined;
  pathEntries?: string[] | undefined;
  shell?: string | undefined;
}

interface InstallerProcessResult {
  exitCode: number | string;
  stderr: string;
  stdout: string;
}

interface ExecFileSuccess {
  stderr: string;
  stdout: string;
}

interface ExecFileFailure extends Error {
  code?: number | string | undefined;
  stderr?: Buffer | string | undefined;
  stdout?: Buffer | string | undefined;
}

interface ShellProfileCase {
  command: (temporaryDirectory: string) => string;
  osName?: string | undefined;
  profile: (temporaryDirectory: string) => string;
  shell: string;
}

describe('render-cli-install-script', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.map(
        async (temporaryDirectory: string): Promise<void> =>
          await rm(temporaryDirectory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });

  it('resolves main installs through the current main commit before downloading the immutable binary', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main'],
      pathEntries: [binDirectory],
    });

    expect(result.stderr).toContain(`Resolved main to ${expectedMainReleaseTag}`);
    expect(result.stdout).toContain(`Installed compartment to ${join(binDirectory, 'compartment')}`);
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.stdout).toContain(createCliOnlyInstallMessage(join(binDirectory, 'compartment')));
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      'https://api.github.com/repos/example/compartment/git/ref/heads/main',
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/checksums.txt`,
    ]);
  });

  it('selects the first supported user bin directory from PATH', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const homeBinDirectory: string = join(temporaryDirectory, 'bin');
    const localBinDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main'],
      pathEntries: [homeBinDirectory, localBinDirectory],
    });

    expect(result.stdout).toContain(`Installed compartment to ${join(homeBinDirectory, 'compartment')}`);
  });

  it('rejects init login arguments outside init login mode', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--version', 'main', '--organization', 'acme-dev', '--onboarding-session', 'fdo_123'],
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Use install, update, and login arguments only with --init-install, --init-update, or --init-login.',
    );
    expect(result.urlLog).toEqual([]);
  });

  it('downloads explicitly pinned sha builds without resolving main', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const explicitReleaseTag: string = 'sha-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', explicitReleaseTag],
      pathEntries: [binDirectory],
    });

    expect(result.stderr).not.toContain('Resolved main to');
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.stdout).toContain(createCliOnlyInstallMessage(join(binDirectory, 'compartment')));
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      `https://github.com/example/compartment/releases/download/${explicitReleaseTag}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/${explicitReleaseTag}/checksums.txt`,
    ]);
  });

  it('downloads stable releases by explicit version without resolving main', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const explicitReleaseVersion: string = '0.8.0';
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', explicitReleaseVersion],
      pathEntries: [binDirectory],
    });

    expect(result.stderr).not.toContain('Resolved main to');
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.stdout).toContain(createCliOnlyInstallMessage(join(binDirectory, 'compartment')));
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      `https://github.com/example/compartment/releases/download/v${explicitReleaseVersion}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/v${explicitReleaseVersion}/checksums.txt`,
    ]);
  });

  it('renders stable release installers pinned to their release by default', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const defaultReleaseVersion: string = '0.8.0';
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [],
      defaultVersion: defaultReleaseVersion,
      pathEntries: [binDirectory],
    });

    expect(result.stderr).not.toContain('Resolved main to');
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.stdout).toContain(createCliOnlyInstallMessage(join(binDirectory, 'compartment')));
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      `https://github.com/example/compartment/releases/download/v${defaultReleaseVersion}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/v${defaultReleaseVersion}/checksums.txt`,
    ]);
  });

  it('lets stable release installers override their pinned default with the main channel', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--channel', 'main'],
      defaultVersion: '0.8.0',
      pathEntries: [binDirectory],
    });

    expect(result.stderr).toContain(`Resolved main to ${expectedMainReleaseTag}`);
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      'https://api.github.com/repos/example/compartment/git/ref/heads/main',
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/checksums.txt`,
    ]);
  });

  it('lets stable release installers override their pinned default with the latest channel', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--channel', 'latest'],
      defaultVersion: '0.8.0',
      pathEntries: [binDirectory],
    });

    expect(result.stderr).not.toContain('Resolved main to');
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      `https://github.com/example/compartment/releases/latest/download/${expectedArtifactName}`,
      'https://github.com/example/compartment/releases/latest/download/checksums.txt',
    ]);
  });

  it('keeps the checked-in source installer rendered from the template', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const renderedInstallerScriptPath: string = join(temporaryDirectory, 'install.sh');

    await execFile(
      'node',
      [
        renderInstallerScriptPath,
        '--repository',
        'compartmentdev/compartment',
        '--output',
        relative(repositoryRoot, renderedInstallerScriptPath),
      ],
      {
        cwd: repositoryRoot,
      },
    );

    const checkedInInstallerScript: string = await readFile(sourceInstallerScriptPath, 'utf8');
    const renderedInstallerScript: string = await readFile(renderedInstallerScriptPath, 'utf8');

    expect(checkedInInstallerScript).toBe(renderedInstallerScript);
    expect(checkedInInstallerScript).toContain('compartmentdev/compartment');
    expect(checkedInInstallerScript).not.toContain('grep -o');
  });

  it('rejects unsafe release repository values before rendering the installer', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const renderedInstallerScriptPath: string = join(temporaryDirectory, 'install.sh');

    let caughtError: ExecFileFailure | undefined;
    try {
      await execFile(
        'node',
        [
          renderInstallerScriptPath,
          '--repository',
          'example/compartment$(touch compromised)',
          '--output',
          relative(repositoryRoot, renderedInstallerScriptPath),
        ],
        {
          cwd: repositoryRoot,
        },
      );
    } catch (error) {
      caughtError = error as ExecFileFailure;
    }

    if (caughtError === undefined) {
      throw new Error('Expected unsafe release repository rendering to fail.');
    }
    expect(readExecFileOutput(caughtError.stderr)).toContain(
      'Expected --repository to use the owner/repo format with only GitHub repository characters.',
    );
  });

  it('falls back to HOME/.local/bin and only prints PATH instructions without an interactive shell', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const missingInstallerTerminalPath: string = join(temporaryDirectory, 'missing-installer-tty');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main'],
      installerTerminalPath: missingInstallerTerminalPath,
      pathEntries: [],
      shell: '/bin/zsh',
    });

    expect(result.stdout).toContain(`Installed compartment to ${join(binDirectory, 'compartment')}`);
    expect(result.stdout).toContain(`${binDirectory} is not on PATH.`);
    expect(result.stdout).toContain(`Add it to ${join(temporaryDirectory, '.zshrc')}, or run for this shell:`);
    expect(result.stdout).toContain(`export PATH="${binDirectory}:$PATH"`);
    await expect(readFile(join(temporaryDirectory, '.zshrc'), 'utf8')).rejects.toThrow();
  });

  it('updates the shell profile when terminal input is readable but terminal output is not writable', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const readOnlyInstallerTerminalPath: string = join(temporaryDirectory, 'read-only-installer-tty');
    await mkdir(readOnlyInstallerTerminalPath);

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main'],
      installerTerminalPath: readOnlyInstallerTerminalPath,
      pathEntries: [],
      shell: '/bin/zsh',
    });

    expect(result.stderr).toContain(
      `${binDirectory} is not on PATH. Add it to ${join(temporaryDirectory, '.zshrc')}? [Y/n]`,
    );
    expect(await readFile(join(temporaryDirectory, '.zshrc'), 'utf8')).toContain(`export PATH="${binDirectory}:$PATH"`);
  });

  const shellProfileCases: ShellProfileCase[] = [
    {
      command: (temporaryDirectory: string): string =>
        `export PATH="${join(temporaryDirectory, '.local', 'bin')}:$PATH"`,
      profile: (temporaryDirectory: string): string => join(temporaryDirectory, '.zshrc'),
      shell: '/bin/zsh',
    },
    {
      command: (temporaryDirectory: string): string =>
        `export PATH="${join(temporaryDirectory, '.local', 'bin')}:$PATH"`,
      profile: (temporaryDirectory: string): string => join(temporaryDirectory, '.bashrc'),
      shell: '/bin/bash',
    },
    {
      command: (temporaryDirectory: string): string =>
        `export PATH="${join(temporaryDirectory, '.local', 'bin')}:$PATH"`,
      osName: 'Darwin',
      profile: (temporaryDirectory: string): string => join(temporaryDirectory, '.zprofile'),
      shell: '/bin/zsh',
    },
    {
      command: (temporaryDirectory: string): string =>
        `export PATH="${join(temporaryDirectory, '.local', 'bin')}:$PATH"`,
      osName: 'Darwin',
      profile: (temporaryDirectory: string): string => join(temporaryDirectory, '.bash_profile'),
      shell: '/bin/bash',
    },
    {
      command: (temporaryDirectory: string): string => `fish_add_path "${join(temporaryDirectory, '.local', 'bin')}"`,
      profile: (temporaryDirectory: string): string => join(temporaryDirectory, '.config', 'fish', 'config.fish'),
      shell: '/usr/bin/fish',
    },
  ];
  it.each(shellProfileCases)(
    'updates $shell profile idempotently when accepted',
    async ({ command, osName, profile, shell }: ShellProfileCase): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const runOptions: InstallerRunOptions = {
        acceptPathUpdate: true,
        args: ['--version', 'main'],
        osName,
        pathEntries: [],
        shell,
      };

      await runInstallerScript(temporaryDirectory, runOptions);
      await runInstallerScript(temporaryDirectory, runOptions);

      const profileText: string = await readFile(profile(temporaryDirectory), 'utf8');
      expect(countOccurrences(profileText, command(temporaryDirectory))).toBe(1);
    },
  );

  it('fails init install clearly when no installer terminal is available', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const missingInstallerTerminalPath: string = join(temporaryDirectory, 'missing-installer-tty');

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--version', 'main', '--init-install', '--values', 'compartment-values.yaml'],
      installerTerminalPath: missingInstallerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Requested \`--init-install\`, but no terminal is available for owner setup. Run \`"${join(binDirectory, 'compartment')}" install --values compartment-values.yaml\` from an interactive shell.`,
    );
    expect(result.sudoInvocations).toEqual([]);
    expect(result.compartmentInvocations).toEqual(['--version']);
  });

  it('hands init install without a base domain to managed-domain installation', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const installerTerminalPath: string = join(temporaryDirectory, 'installer-tty');
    await writeFile(installerTerminalPath, '', 'utf8');

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main', '--init-install', '--values', 'compartment-values.yaml'],
      installerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.compartmentInvocations).toEqual(['--version', 'install --values compartment-values.yaml']);
  });

  it('runs the Kubernetes install command through init install without sudo or host-runtime setup', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const installerTerminalPath: string = join(temporaryDirectory, 'installer-tty');
    await writeFile(installerTerminalPath, '', 'utf8');

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [
        '--version',
        'main',
        '--init-install',
        '--api-url',
        'https://console.apps.example.com',
        '--base-domain',
        'apps.example.com',
        '--values',
        'compartment-values.yaml',
        '--email',
        'admin@example.com',
        '--organization',
        'Acme Dev',
        '--organization-slug',
        'acme-dev',
        '--kube-context',
        'prod-eu',
        '--namespace',
        'compartment-prod',
        '--release-name',
        'compartment-prod',
        '--chart',
        './compartment-chart',
        '--remote',
        'prod-eu',
      ],
      installerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.compartmentInvocations).toEqual([
      '--version',
      'install --values compartment-values.yaml --api-url https://console.apps.example.com --base-domain apps.example.com --email admin@example.com --organization Acme Dev --organization-slug acme-dev --kube-context prod-eu --namespace compartment-prod --release-name compartment-prod --chart ./compartment-chart --remote prod-eu',
    ]);
    expect(result.sudoInvocations).toEqual([]);
  });

  it('runs the verified Kubernetes update through init update', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [
        '--version',
        'main',
        '--init-update',
        '--values',
        'compartment-values.yaml',
        '--kube-context',
        'prod-eu',
        '--namespace',
        'compartment-prod',
        '--release-name',
        'compartment-prod',
        '--chart',
        './compartment-chart',
      ],
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.sudoInvocations).toEqual([]);
    expect(result.compartmentInvocations).toEqual([
      '--version',
      'system update --values compartment-values.yaml --kube-context prod-eu --namespace compartment-prod --release-name compartment-prod --chart ./compartment-chart',
    ]);
  });

  it('requires operator values for init update before downloading the CLI', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--version', 'main', '--init-update'],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Expected --values <path> with --init-update.');
    expect(result.urlLog).toEqual([]);
  });

  it('fails init login clearly when no installer terminal is available', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const missingInstallerTerminalPath: string = join(temporaryDirectory, 'missing-installer-tty');
    const shellQuotedEmail: string = "'o'\\''hara@example.com'";
    const shellQuotedOrganization: string = "'acme dev'";
    const expectedLoginCommand: string = `"${join(binDirectory, 'compartment')}" login --api-url https://console.example --email ${shellQuotedEmail} --organization ${shellQuotedOrganization} --onboarding-session fdo_123`;

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: [
        '--version',
        'main',
        '--init-login',
        '--api-url',
        'https://console.example',
        '--email',
        "o'hara@example.com",
        '--organization',
        'acme dev',
        '--onboarding-session',
        'fdo_123',
      ],
      installerTerminalPath: missingInstallerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Requested \`--init-login\`, but no terminal is available for the password prompt. Run \`${expectedLoginCommand}\` from an interactive shell.`,
    );
  });

  it('prompts for init login email when terminal input is readable', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const installerTerminalPath: string = join(temporaryDirectory, 'installer-tty');
    await writeFile(installerTerminalPath, 'admin@example.com\n', 'utf8');
    await chmod(installerTerminalPath, 0o444);

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [
        '--version',
        'main',
        '--init-login',
        '--api-url',
        'https://console.example',
        '--organization',
        'acme-dev',
        '--onboarding-session',
        'fdo_123',
      ],
      installerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Email: ');
    expect(result.stdout).toContain(
      `Running \`"${join(binDirectory, 'compartment')}" login --api-url https://console.example --email admin@example.com --organization acme-dev --onboarding-session fdo_123\``,
    );
    expect(result.stdout).toContain('Logged in to https://console.example as admin@example.com.');
  });

  it('runs init login when terminal input is readable but terminal output is not writable', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const readOnlyInstallerTerminalPath: string = join(temporaryDirectory, 'read-only-installer-tty');
    const expectedLoginCommand: string = `"${join(binDirectory, 'compartment')}" login --api-url https://console.example --email admin@example.com --organization acme-dev --onboarding-session fdo_123`;
    await mkdir(readOnlyInstallerTerminalPath);

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [
        '--version',
        'main',
        '--init-login',
        '--api-url',
        'https://console.example',
        '--email',
        'admin@example.com',
        '--organization',
        'acme-dev',
        '--onboarding-session',
        'fdo_123',
      ],
      installerTerminalPath: readOnlyInstallerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Running \`${expectedLoginCommand}\``);
    expect(result.stdout).toContain('Logged in to https://console.example as admin@example.com.');
    expect(result.installerTerminalOutput).toBe('');
    expect(result.compartmentInvocations).toEqual([
      '--version',
      'login --api-url https://console.example --email admin@example.com --organization acme-dev --onboarding-session fdo_123',
    ]);
  });
});

function createCliOnlyInstallMessage(installPath: string): string {
  return `Installed CLI. Run \`"${installPath}" install\` to create a Kubernetes platform owner, run \`"${installPath}" login\` to connect to a platform, or use \`--init-install\`/\`--init-update\`/\`--init-login\`.`;
}

async function createTemporaryDirectory(): Promise<string> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-installer-'));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

async function runInstallerScript(
  temporaryDirectory: string,
  options: InstallerRunOptions,
): Promise<InstallerScriptResult> {
  const installerScriptPath: string = join(temporaryDirectory, 'install.sh');
  const stateDirectory: string = join(temporaryDirectory, 'state');
  const stubCommandDirectory: string = join(temporaryDirectory, 'stub-bin');
  const fixture: InstallerFixture = await createInstallerFixture(temporaryDirectory, options.osName);
  const pathEntries: string[] = options.pathEntries ?? [join(temporaryDirectory, '.local', 'bin')];

  await renderInstallerScript(installerScriptPath, options);
  await createStubCommands(stubCommandDirectory, options.osName);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: temporaryDirectory,
    PATH: [stubCommandDirectory, ...pathEntries, defaultPath].join(':'),
    SHELL: options.shell ?? process.env.SHELL,
    COMPARTMENT_TEST_ARTIFACT_PATH: fixture.tarballPath,
    COMPARTMENT_TEST_CHECKSUMS_PATH: fixture.checksumsPath,
    COMPARTMENT_TEST_STATE_DIR: stateDirectory,
  };
  if (options.acceptPathUpdate === true) {
    environment.COMPARTMENT_INSTALLER_ACCEPT_PATH_UPDATE = '1';
  } else {
    delete environment.COMPARTMENT_INSTALLER_ACCEPT_PATH_UPDATE;
  }

  const commandArguments: string[] = [installerScriptPath, ...options.args];
  if (options.binDir !== undefined) {
    commandArguments.push('--bin-dir', options.binDir);
  }
  const result: InstallerProcessResult = await executeInstallerScript(
    commandArguments,
    temporaryDirectory,
    environment,
    options,
  );

  return {
    compartmentInvocations: await readLogLines(join(stateDirectory, 'compartment.log')),
    exitCode: result.exitCode,
    installerTerminalOutput: await readOptionalText(options.installerTerminalPath),
    stderr: result.stderr,
    stdout: result.stdout,
    sudoInvocations: await readLogLines(join(stateDirectory, 'sudo.log')),
    urlLog: await readLogLines(join(stateDirectory, 'urls.log')),
  };
}

async function executeInstallerScript(
  commandArguments: string[],
  temporaryDirectory: string,
  environment: NodeJS.ProcessEnv,
  options: InstallerRunOptions,
): Promise<InstallerProcessResult> {
  try {
    const result: ExecFileSuccess = await execFile('sh', commandArguments, {
      cwd: temporaryDirectory,
      env: environment,
    });
    return {
      exitCode: 0,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } catch (error) {
    if (options.allowFailure === true && error instanceof Error) {
      const execFileFailure: ExecFileFailure = error;
      return {
        exitCode: execFileFailure.code ?? 1,
        stderr: readExecFileOutput(execFileFailure.stderr),
        stdout: readExecFileOutput(execFileFailure.stdout),
      };
    }

    throw error;
  }
}

async function renderInstallerScript(outputPath: string, options: InstallerRunOptions): Promise<void> {
  const args: string[] = [renderInstallerScriptPath, '--repository', 'example/compartment'];
  if (options.defaultVersion !== undefined) {
    args.push('--default-version', options.defaultVersion);
  }
  args.push('--output', relative(repositoryRoot, outputPath));

  await execFile('node', args, {
    cwd: repositoryRoot,
  });

  if (options.installerTerminalPath !== undefined) {
    const scriptText: string = await readFile(outputPath, 'utf8');
    await writeFile(outputPath, scriptText.replaceAll('/dev/tty', options.installerTerminalPath), 'utf8');
    await chmod(outputPath, 0o755);
  }
}

async function createInstallerFixture(temporaryDirectory: string, osName?: string): Promise<InstallerFixture> {
  const fixtureDirectory: string = join(temporaryDirectory, 'fixture');
  const packageDirectory: string = join(fixtureDirectory, 'package');
  const artifactName: string = readExpectedArtifactName(osName);
  const compartmentBinaryPath: string = join(packageDirectory, 'compartment');
  const tarballPath: string = join(fixtureDirectory, artifactName);
  const checksumsPath: string = join(fixtureDirectory, 'checksums.txt');

  await mkdir(packageDirectory, { recursive: true });
  await writeExecutableScript(compartmentBinaryPath, buildInstalledCompartmentScript());
  await execFile('tar', ['-czf', tarballPath, '-C', packageDirectory, 'compartment'], {
    cwd: temporaryDirectory,
  });
  await writeFile(checksumsPath, await createChecksumsFile(artifactName, tarballPath), 'utf8');

  return {
    artifactName,
    checksumsPath,
    tarballPath,
  };
}

async function createChecksumsFile(artifactName: string, tarballPath: string): Promise<string> {
  const tarballContents: Buffer = await readFile(tarballPath);
  const checksum: string = createHash('sha256').update(tarballContents).digest('hex');
  const installerChecksum: string = createHash('sha256').update('# stable installer asset\n').digest('hex');
  return `${checksum}  ${artifactName}\n${installerChecksum}  install.sh\n`;
}

function readExpectedArtifactName(osName?: string): string {
  return normalizeInstallerOsName(osName) === 'darwin' ? 'compartment-darwin-x64.tar.gz' : expectedArtifactName;
}

function normalizeInstallerOsName(osName?: string): string {
  return (osName ?? 'Linux').trim().toLowerCase();
}

async function createStubCommands(stubCommandDirectory: string, osName?: string): Promise<void> {
  await mkdir(stubCommandDirectory, { recursive: true });
  await writeExecutableScript(join(stubCommandDirectory, 'curl'), buildStubCurlScript());
  await writeExecutableScript(join(stubCommandDirectory, 'uname'), buildStubUnameScript(osName));
  await writeExecutableScript(join(stubCommandDirectory, 'sudo'), buildStubSudoScript());
}

function buildStubCurlScript(): string {
  return createShellScript(`
artifact_path="\${COMPARTMENT_TEST_ARTIFACT_PATH:?}"
checksums_path="\${COMPARTMENT_TEST_CHECKSUMS_PATH:?}"
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"

mkdir -p "$state_dir"
output_path=""
url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output_path="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

printf '%s\\n' "$url" >> "\${state_dir}/urls.log"

case "$url" in
  https://api.github.com/repos/example/compartment/git/ref/heads/main)
    printf '{"object":{"sha":"${expectedMainCommitSha}"}}\\n'
    ;;
  https://github.com/example/compartment/releases/download/sha-*/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/sha-*/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/v*/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/v*/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/latest/download/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/latest/download/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  *)
    printf 'Unexpected curl URL: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`);
}

function buildStubUnameScript(osName: string = 'Linux'): string {
  return createShellScript(`
case "\${1:-}" in
  -s)
    printf '${osName}\\n'
    ;;
  -m)
    printf 'x86_64\\n'
    ;;
  *)
    printf 'Unexpected uname args: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
}

function buildInstalledCompartmentScript(): string {
  return createShellScript(`
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/compartment.log"

  case "\${1:-}" in
  --version)
    printf '${expectedInstalledVersion}\\n'
    ;;
  install)
    printf 'Installed Compartment.\\n'
    ;;
  login)
    api_url=""
    email=""
    organization=""
    onboarding_session=""
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --api-url)
          api_url="$2"
          shift 2
          ;;
        --email)
          email="$2"
          shift 2
          ;;
        --organization)
          organization="$2"
          shift 2
          ;;
        --onboarding-session)
          onboarding_session="$2"
          shift 2
          ;;
        *)
          printf 'Unexpected login arg: %s\\n' "$1" >&2
          exit 1
          ;;
      esac
    done
    printf 'Logged in to %s as %s.\\n' "$api_url" "$email"
    ;;
  system)
    if [ "\${2:-}" != "update" ]; then
      printf 'Unexpected system command: %s\\n' "$*" >&2
      exit 1
    fi
    printf 'Updated Compartment platform.\\n'
    ;;
  *)
    printf 'Unexpected installed compartment args: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
}

function buildStubSudoScript(): string {
  return createShellScript(`
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/sudo.log"
exec "$@"
`);
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function createShellScript(body: string): string {
  return `#!/bin/sh
set -eu

${body.trim()}
`;
}

async function readLogLines(logPath: string): Promise<string[]> {
  try {
    const logText: string = await readFile(logPath, 'utf8');
    const trimmedLogText: string = logText.trim();
    return trimmedLogText === '' ? [] : trimmedLogText.split('\n');
  } catch (error) {
    if (isMissingFileError(error as NodeJS.ErrnoException | Error)) {
      return [];
    }

    throw error;
  }
}

async function readOptionalText(path: string | undefined): Promise<string> {
  if (path === undefined) {
    return '';
  }

  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const caughtError: NodeJS.ErrnoException | Error = error as NodeJS.ErrnoException | Error;
    if (isMissingFileError(caughtError) || isDirectoryReadError(caughtError)) {
      return '';
    }

    throw error;
  }
}

function isDirectoryReadError(error: NodeJS.ErrnoException | Error): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EISDIR';
}

async function writeExecutableScript(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, 'utf8');
  await chmod(path, 0o755);
}

function readExecFileOutput(output: Buffer | string | undefined): string {
  if (Buffer.isBuffer(output)) {
    return output.toString('utf8');
  }

  return output ?? '';
}

function isMissingFileError(error: NodeJS.ErrnoException | Error): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
