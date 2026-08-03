import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildInstalledCompartmentScript,
  createStubCommands,
  expectedArtifactName,
  expectedCliDigestRef,
  expectedInstalledVersion,
  expectedKubernetesCommitSha,
  expectedKubernetesReleaseTag,
  expectedMainReleaseTag,
  expectedPublishedCliDigestRef,
  expectedPublishedKubernetesCommitSha,
  expectedPublishedKubernetesReleaseTag,
  readExpectedArtifactName,
  readExpectedOrasPlatform,
  writeExecutableScript,
} from './install-cli-script-test.fixtures';
import type {
  ExecFileFailure,
  ExecFileSuccess,
  InstallerFixture,
  InstallerProcessResult,
  InstallerRunOptions,
  InstallerScriptResult,
  InstallerSignatureOutcome,
  PublishedFallbackOutcome,
  ShellProfileCase,
} from './install-cli-script-test.types';
import {
  isMissingFileError,
  readExecFileOutput,
  readOptionalText,
  replaceInstallerTerminal,
} from './install-cli-script-test.harness';

const defaultPath: string = process.env.PATH ?? '/usr/bin:/bin';
const execFile: (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv | undefined;
  },
) => Promise<ExecFileSuccess> = promisify(execFileCallback);
const repositoryRoot: string = resolve(__dirname, '../../..');
const renderInstallerScriptPath: string = resolve(repositoryRoot, 'scripts/release/render-cli-install-script.mjs');
const sourceInstallerScriptPath: string = resolve(repositoryRoot, 'install.sh');
const temporaryDirectories: string[] = [];

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
      args: ['--version', 'main', '--verbose'],
      pathEntries: [binDirectory],
    });

    expect(result.stderr).toContain(`Resolved main to ${expectedMainReleaseTag}`);
    expect(result.stdout).toContain(`Installed to ${join(binDirectory, 'compartment')}`);
    expect(result.stdout).toContain(expectedInstalledVersion);
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      'https://api.github.com/repos/example/compartment/git/ref/heads/main',
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/${expectedMainReleaseTag}/checksums.txt`,
    ]);
  });

  it('defaults the public installer to the signed immutable CLI artifact from the kubernetes branch head', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: [],
      pathEntries: [binDirectory],
    });

    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(
      new RegExp(
        `^Verified signed Compartment CLI\\nDownloaded CLI \\(\\d+(?:\\.\\d)? (?:B|KB|MB|GB)\\)\\nInstalled to ${escapeRegExp(join(binDirectory, 'compartment'))}\\n${escapeRegExp(expectedInstalledVersion)}\\n$`,
        'u',
      ),
    );
    expect(result.stdout).not.toContain('Skipped pulling layers');
    expect(result.stdout).not.toContain('sha256:');
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual(['https://api.github.com/repos/example/compartment/git/ref/heads/kubernetes']);
    expect(result.cosignInvocations).toEqual([
      `verify --new-bundle-format --certificate-identity https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-sha ${expectedKubernetesCommitSha} ${expectedCliDigestRef}`,
    ]);
    expect(result.orasInvocations[0]).toBe(
      `resolve ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}`,
    );
    expect(result.orasInvocations[1]).toMatch(
      new RegExp(`^pull --platform linux/amd64 --output .+ ${expectedCliDigestRef}$`, 'u'),
    );
  });

  it('shows installer diagnostics on verbose Kubernetes success', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--verbose'],
      pathEntries: [binDirectory],
    });

    expect(result.stdout).toContain('Verified signed Compartment CLI');
    expect(result.stderr).toContain(`Resolved kubernetes to ${expectedKubernetesReleaseTag}`);
    expect(result.stderr).toContain('cosign verification internals');
    expect(result.stderr).toContain(`Verified OCI artifact ${expectedCliDigestRef}`);
    expect(result.stderr).toContain('Skipped pulling layers without selected files');
    expect(result.stderr).toContain(`${expectedArtifactName}: OK`);
  });

  it('replays captured ORAS diagnostics when the CLI download fails', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: [],
      orasPullFailure: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('registry download interrupted after 42 MB');
    expect(result.stdout).toBe('Verified signed Compartment CLI\n');
  });

  it.each([
    ['version before channel', ['--version', expectedKubernetesReleaseTag, '--channel', 'kubernetes']],
    ['channel before version', ['--channel', 'kubernetes', '--version', expectedKubernetesReleaseTag]],
  ] as const)(
    'installs an explicitly pinned version from the kubernetes channel: %s',
    async (_label: string, args: readonly string[]): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        args: [...args],
      });

      expect(result.exitCode).toBe(0);
      expect(result.urlLog).toEqual([]);
      expect(result.orasInvocations[0]).toBe(
        `resolve ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}`,
      );
      expect(result.cosignInvocations).toEqual([
        `verify --new-bundle-format --certificate-identity https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-sha ${expectedKubernetesCommitSha} ${expectedCliDigestRef}`,
      ]);
      expect(result.compartmentInvocations).toEqual(['--version']);
    },
  );

  it.each([
    ['a short sha', 'sha-1234'],
    ['a semantic version', '0.9.2'],
    ['an uppercase sha', 'sha-ABCDEF1234567890ABCDEF1234567890ABCDEF12'],
  ] as const)(
    'rejects %s for the kubernetes channel with a human-readable format error',
    async (_label: string, version: string): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        allowFailure: true,
        args: ['--channel', 'kubernetes', '--version', version],
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `Invalid version for the kubernetes channel: ${version}. Expected sha- followed by 40 lowercase hexadecimal characters.`,
      );
      expect(result.stderr).not.toContain('Error:');
      expect(result.urlLog).toEqual([]);
      expect(result.orasInvocations).toEqual([]);
    },
  );

  it.each([
    ['an empty build suffix', '1.2.3+'],
    ['empty build identifiers', '1.2.3+.'],
    ['empty prerelease identifiers', '1.2.3-alpha..1'],
    ['an empty prerelease suffix', '1.2.3-'],
    ['leading zero core identifiers', '1.02.3'],
  ] as const)(
    'rejects semantic versions with %s in the latest channel',
    async (_label: string, version: string): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        allowFailure: true,
        args: ['--channel', 'latest', '--version', version],
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `Invalid version for the latest channel: ${version}. Expected a semantic version or sha- followed by 40 lowercase hexadecimal characters.`,
      );
      expect(result.urlLog).toEqual([]);
    },
  );

  it('offers the latest fully published Kubernetes build when the channel tip is still publishing', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--channel', 'kubernetes'],
      orasResolveOutcome: 'missing',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Images for ${expectedKubernetesReleaseTag} are still publishing. Install the latest fully published kubernetes build with:`,
    );
    expect(result.stderr).toContain(
      `sh install.sh --channel kubernetes --version ${expectedPublishedKubernetesReleaseTag}`,
    );
    expect(result.stderr).toContain('Error response from registry');
    expect(result.orasInvocations).toEqual([
      `resolve ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}`,
      `resolve ghcr.io/compartmentdev/compartment-cli:${expectedPublishedKubernetesReleaseTag}`,
    ]);
    expect(result.urlLog).toEqual([
      'https://api.github.com/repos/example/compartment/git/ref/heads/kubernetes',
      'https://api.github.com/repos/example/compartment/actions/workflows/publish-self-hosted-kubernetes.yml/runs?branch=kubernetes&status=success&per_page=1',
    ]);
    expect(result.cosignInvocations).toEqual([
      `verify --new-bundle-format --certificate-identity https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-sha ${expectedPublishedKubernetesCommitSha} ${expectedPublishedCliDigestRef}`,
    ]);
    expect(result.compartmentInvocations).toEqual([]);
  });

  it('reports an unpublished explicit Kubernetes pin without claiming fallback discovery failed', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--channel', 'kubernetes', '--version', expectedKubernetesReleaseTag],
      orasResolveOutcome: 'missing',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Kubernetes CLI image tag ${expectedKubernetesReleaseTag} was not found in the registry. Check that the build was published and that the version is not mistyped.`,
    );
    expect(result.stderr).toContain('To install the current kubernetes channel tip instead, omit --version:');
    expect(result.stderr).toContain('sh install.sh --channel kubernetes');
    expect(result.stderr).not.toContain('fallback automatically');
    expect(result.stderr).not.toContain(`--version ${expectedKubernetesReleaseTag}`);
    expect(result.urlLog).toEqual([]);
    expect(result.orasInvocations).toEqual([
      `resolve ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}`,
    ]);
  });

  it.each([
    ['the publication lookup has no successful run', 'lookup-missing'],
    ['the fallback artifact is unavailable', 'resolve-missing'],
    ['the fallback signature is invalid', 'signature-invalid'],
  ] as const)(
    'provides a safe manual discovery path when %s',
    async (_label: string, publishedFallbackOutcome: PublishedFallbackOutcome): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        allowFailure: true,
        args: ['--channel', 'kubernetes'],
        orasResolveOutcome: 'missing',
        publishedFallbackOutcome,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('the installer could not verify a fallback automatically');
      expect(result.stderr).toContain(
        'https://github.com/example/compartment/actions/workflows/publish-self-hosted-kubernetes.yml',
      );
      expect(result.stderr).toContain('sh install.sh --channel kubernetes --version sha-COMMIT_SHA');
      expect(result.stderr).not.toContain('sha-<');
      expect(result.compartmentInvocations).toEqual([]);
    },
  );

  it('keeps non-publishing registry failures distinct', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--channel', 'kubernetes'],
      orasResolveOutcome: 'unavailable',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Failed to resolve Kubernetes CLI image ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}. Check registry access and retry.`,
    );
    expect(result.stderr).not.toContain('still publishing');
    expect(result.stderr).toContain('registry unavailable');
  });

  it.each([
    ['an unsigned artifact', 'unsigned', 'no signatures found'],
    ['an artifact signed by another identity', 'foreign-identity', 'certificate identity mismatch'],
    ['an artifact signed by another workflow run', 'wrong-workflow-sha', 'workflow SHA mismatch'],
  ] as const)(
    'fails closed before pulling %s',
    async (_label: string, signatureOutcome: InstallerSignatureOutcome, expectedError: string): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        allowFailure: true,
        args: ['--channel', 'kubernetes'],
        pathEntries: [binDirectory],
        signatureOutcome,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(expectedError);
      expect(result.stderr).toContain(`Failed to verify Kubernetes CLI artifact ${expectedCliDigestRef}`);
      expect(result.orasInvocations.filter((invocation: string): boolean => invocation.startsWith('pull '))).toEqual(
        [],
      );
      expect(result.compartmentInvocations).toEqual([]);
      await expect(readFile(join(binDirectory, 'compartment'), 'utf8')).rejects.toThrow();
    },
  );

  it.each([
    ['Darwin x64', 'Darwin', 'x86_64', 'darwin/amd64', 'compartment-darwin-x64.tar.gz'],
    ['Linux arm64', 'Linux', 'aarch64', 'linux/arm64', 'compartment-linux-arm64.tar.gz'],
  ] as const)(
    'selects the signed OCI platform for %s',
    async (
      _label: string,
      osName: string,
      archName: string,
      expectedPlatform: string,
      expectedPlatformArtifact: string,
    ): Promise<void> => {
      const temporaryDirectory: string = await createTemporaryDirectory();
      const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
      const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
        archName,
        args: ['--channel', 'kubernetes'],
        osName,
        pathEntries: [binDirectory],
      });

      expect(result.orasInvocations[1]).toMatch(
        new RegExp(`^pull --platform ${expectedPlatform} --output .+ ${expectedCliDigestRef}$`, 'u'),
      );
      expect(result.stdout).toContain(`Installed to ${join(binDirectory, 'compartment')}`);
      expect(result.compartmentInvocations).toEqual(['--version']);
      expect(result.stderr).not.toContain(`Missing checksum entry for ${expectedPlatformArtifact}`);
    },
  );

  it('falls back from incompatible PATH tools and fails closed on a bootstrapped tool checksum mismatch', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: ['--channel', 'kubernetes'],
      pathEntries: [binDirectory],
      toolVersionMode: 'incompatible',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Checksum mismatch for cosign-linux-amd64');
    expect(result.urlLog).toEqual([
      'https://api.github.com/repos/example/compartment/git/ref/heads/kubernetes',
      'https://github.com/sigstore/cosign/releases/download/v2.6.1/cosign-linux-amd64',
    ]);
    expect(result.cosignInvocations).toEqual([]);
    expect(result.orasInvocations).toEqual([]);
    expect(result.compartmentInvocations).toEqual([]);
  });

  it('selects the first supported user bin directory from PATH', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const homeBinDirectory: string = join(temporaryDirectory, 'bin');
    const localBinDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main'],
      pathEntries: [homeBinDirectory, localBinDirectory],
    });

    expect(result.stdout).toContain(`Installed to ${join(homeBinDirectory, 'compartment')}`);
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

  it('reports that --values is only valid with init update when combined with init login', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      allowFailure: true,
      args: [
        '--version',
        'main',
        '--init-login',
        '--api-url',
        'https://api.example.test',
        '--values',
        '/tmp/values.yaml',
      ],
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Use --values only with --init-update.');
    expect(result.stderr).not.toContain('Use Kubernetes lifecycle options only');
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
    expect(result.compartmentInvocations).toEqual(['--version']);
    expect(result.urlLog).toEqual([
      `https://github.com/example/compartment/releases/download/v${explicitReleaseVersion}/${expectedArtifactName}`,
      `https://github.com/example/compartment/releases/download/v${explicitReleaseVersion}/checksums.txt`,
    ]);
  });

  it('accepts a semantic version with prerelease and build metadata in the latest channel', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const explicitReleaseVersion: string = '0.9.2-kubernetes+d7cea10';
    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--channel', 'latest', '--version', explicitReleaseVersion],
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
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
      args: ['--channel', 'main', '--verbose'],
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
    expect(checkedInInstallerScript).toContain('curl -fsSL https://compartment.dev/k/install.sh | sh -s --');
    expect(checkedInInstallerScript).not.toContain('curl -fsSL https://compartment.dev/install.sh | sh -s --');
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

    expect(result.stdout).toContain(`Installed to ${join(binDirectory, 'compartment')}`);
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
      args: ['--version', 'main', '--init-install'],
      installerTerminalPath: missingInstallerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Requested \`--init-install\`, but no terminal is available for owner setup. Run \`"${join(binDirectory, 'compartment')}" install\` from an interactive shell.`,
    );
    expect(result.sudoInvocations).toEqual([]);
    expect(result.compartmentInvocations).toEqual(['--version']);
  });

  it('hands init install without values to the guided install', async (): Promise<void> => {
    const temporaryDirectory: string = await createTemporaryDirectory();
    const binDirectory: string = join(temporaryDirectory, '.local', 'bin');
    const installerTerminalPath: string = join(temporaryDirectory, 'installer-tty');
    await writeFile(installerTerminalPath, '', 'utf8');

    const result: InstallerScriptResult = await runInstallerScript(temporaryDirectory, {
      args: ['--version', 'main', '--init-install'],
      installerTerminalPath,
      pathEntries: [binDirectory],
    });

    expect(result.exitCode).toBe(0);
    expect(result.compartmentInvocations).toEqual(['--version', 'install']);
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
      'install --api-url https://console.apps.example.com --base-domain apps.example.com --email admin@example.com --organization Acme Dev --organization-slug acme-dev --kube-context prod-eu --namespace compartment-prod --release-name compartment-prod --chart ./compartment-chart --remote prod-eu',
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
    const installerTerminalOutputPath: string = join(temporaryDirectory, 'installer-tty-output');
    await writeFile(installerTerminalPath, 'admin@example.com\n', 'utf8');
    await mkdir(installerTerminalOutputPath);
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
      installerTerminalOutputPath,
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

async function createTemporaryDirectory(): Promise<string> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-installer-'));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function runInstallerScript(
  temporaryDirectory: string,
  options: InstallerRunOptions,
): Promise<InstallerScriptResult> {
  const installerScriptPath: string = join(temporaryDirectory, 'install.sh');
  const stateDirectory: string = join(temporaryDirectory, 'state');
  const stubCommandDirectory: string = join(temporaryDirectory, 'stub-bin');
  const fixture: InstallerFixture = await createInstallerFixture(temporaryDirectory, options.osName, options.archName);
  const pathEntries: string[] = options.pathEntries ?? [join(temporaryDirectory, '.local', 'bin')];

  await renderInstallerScript(installerScriptPath, options);
  await createStubCommands(stubCommandDirectory, options);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: temporaryDirectory,
    PATH: [stubCommandDirectory, ...pathEntries, defaultPath].join(':'),
    SHELL: options.shell ?? process.env.SHELL,
    COMPARTMENT_TEST_ARTIFACT_PATH: fixture.tarballPath,
    COMPARTMENT_TEST_CHECKSUMS_PATH: fixture.checksumsPath,
    COMPARTMENT_TEST_EXPECTED_ARTIFACT_NAME: fixture.artifactName,
    COMPARTMENT_TEST_EXPECTED_ORAS_PLATFORM: readExpectedOrasPlatform(options.osName, options.archName),
    COMPARTMENT_TEST_ORAS_RESOLVE_OUTCOME: options.orasResolveOutcome ?? 'valid',
    COMPARTMENT_TEST_ORAS_PULL_OUTCOME: options.orasPullFailure === true ? 'failure' : 'success',
    COMPARTMENT_TEST_PUBLISHED_FALLBACK_OUTCOME: options.publishedFallbackOutcome ?? 'valid',
    COMPARTMENT_TEST_SIGNATURE_OUTCOME: options.signatureOutcome ?? 'valid',
    COMPARTMENT_TEST_STATE_DIR: stateDirectory,
    COMPARTMENT_TEST_TOOL_VERSION_MODE: options.toolVersionMode ?? 'compatible',
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
    cosignInvocations: await readLogLines(join(stateDirectory, 'cosign.log')),
    compartmentInvocations: await readLogLines(join(stateDirectory, 'compartment.log')),
    exitCode: result.exitCode,
    installerTerminalOutput: await readOptionalText(
      options.installerTerminalOutputPath ?? options.installerTerminalPath,
    ),
    orasInvocations: await readLogLines(join(stateDirectory, 'oras.log')),
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
    const installerTerminalOutputPath: string = options.installerTerminalOutputPath ?? options.installerTerminalPath;
    await writeFile(
      outputPath,
      await replaceInstallerTerminal(scriptText, options.installerTerminalPath, installerTerminalOutputPath),
      'utf8',
    );
    await chmod(outputPath, 0o755);
  }
}

async function createInstallerFixture(
  temporaryDirectory: string,
  osName?: string,
  archName?: string,
): Promise<InstallerFixture> {
  const fixtureDirectory: string = join(temporaryDirectory, 'fixture');
  const packageDirectory: string = join(fixtureDirectory, 'package');
  const artifactName: string = readExpectedArtifactName(osName, archName);
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

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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
