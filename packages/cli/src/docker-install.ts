import { readFile } from 'node:fs/promises';
import { hasText } from '@compartment/utils';
import type { InstallProgressReporter } from './install.types';
import { readCommandOutput, runCappedCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import {
  readRootCommandSpec,
  reportRootCommandInstallProgress,
  type RootCommandSpec,
} from './docker-install-root-command';

const dockerKeyringDirectory: string = '/etc/apt/keyrings';
const dockerKeyringPath: string = '/etc/apt/keyrings/docker.asc';
const dockerSourcesPath: string = '/etc/apt/sources.list.d/docker.sources';
const dockerPackages: readonly string[] = [
  'docker-ce',
  'docker-ce-cli',
  'containerd.io',
  'docker-buildx-plugin',
  'docker-compose-plugin',
];

type SupportedDockerAptDistributionId = 'debian' | 'ubuntu';

interface OsReleaseValues {
  ID?: string | undefined;
  UBUNTU_CODENAME?: string | undefined;
  VERSION_CODENAME?: string | undefined;
}

interface SupportedDockerAptDistribution {
  codename: string;
  id: SupportedDockerAptDistributionId;
}

interface OsReleaseEntry {
  name: keyof OsReleaseValues;
  value: string;
}

export async function installDockerEngine(reportProgress?: InstallProgressReporter): Promise<void> {
  const distribution: SupportedDockerAptDistribution = await readSupportedDockerAptDistribution();
  const rootCommandSpec: RootCommandSpec = await readRootCommandSpec();

  reportProgress?.('Docker Engine is missing. Installing Docker Engine and the Docker Compose plugin...');
  reportRootCommandInstallProgress(rootCommandSpec, reportProgress);
  await installDockerAptPrerequisites(rootCommandSpec);
  await configureDockerAptRepository(rootCommandSpec, distribution, reportProgress);
  await installDockerPackages(rootCommandSpec, reportProgress);
}

async function readSupportedDockerAptDistribution(): Promise<SupportedDockerAptDistribution> {
  assertLinuxHost();
  const osReleaseText: string = await readFile('/etc/os-release', 'utf8');
  const osReleaseValues: OsReleaseValues = parseOsRelease(osReleaseText);
  const distributionId: SupportedDockerAptDistributionId = readSupportedDistributionId(osReleaseValues);
  const codename: string = readSupportedDistributionCodename(osReleaseValues);

  return {
    codename,
    id: distributionId,
  };
}

function parseOsRelease(text: string): OsReleaseValues {
  const values: OsReleaseValues = {};

  for (const line of text.split('\n')) {
    const entry: OsReleaseEntry | undefined = readOsReleaseEntry(line);
    if (entry === undefined) {
      continue;
    }

    values[entry.name] = entry.value;
  }

  return values;
}

function readOsReleaseEntry(line: string): OsReleaseEntry | undefined {
  const [rawName, ...rest] = line.split('=');
  const rawValue: string = rest.join('=').trim();
  if (!hasText(rawName) || !hasText(rawValue)) {
    return undefined;
  }

  if (rawName !== 'ID' && rawName !== 'VERSION_CODENAME' && rawName !== 'UBUNTU_CODENAME') {
    return undefined;
  }

  return {
    name: rawName,
    value: rawValue.replace(/^"/u, '').replace(/"$/u, ''),
  };
}

function assertLinuxHost(): void {
  if (process.platform === 'linux') {
    return;
  }

  throwUnsupportedDistributionError();
}

function readSupportedDistributionId(osReleaseValues: OsReleaseValues): SupportedDockerAptDistributionId {
  const distributionId: string | undefined = osReleaseValues.ID?.toLowerCase();
  if (distributionId === 'ubuntu' || distributionId === 'debian') {
    return distributionId;
  }

  throwUnsupportedDistributionError();
}

async function installDockerAptPrerequisites(rootCommandSpec: RootCommandSpec): Promise<void> {
  await runRequiredCommand(
    rootCommandSpec,
    ['apt-get', 'update'],
    'Failed to refresh apt metadata before installing Docker.',
  );
  await runRequiredCommand(
    rootCommandSpec,
    ['apt-get', 'install', '-y', 'ca-certificates', 'curl'],
    'Failed to install Docker apt prerequisites.',
  );
}

async function configureDockerAptRepository(
  rootCommandSpec: RootCommandSpec,
  distribution: SupportedDockerAptDistribution,
  reportProgress?: InstallProgressReporter,
): Promise<void> {
  reportProgress?.(`Configuring the Docker apt repository for ${distribution.id} ${distribution.codename}...`);
  await runRequiredCommand(
    rootCommandSpec,
    ['install', '-m', '0755', '-d', dockerKeyringDirectory],
    'Failed to create the Docker apt keyring directory.',
  );
  await runRequiredShellCommand(
    rootCommandSpec,
    `curl -fsSL https://download.docker.com/linux/${distribution.id}/gpg -o ${dockerKeyringPath} && chmod a+r ${dockerKeyringPath}`,
    'Failed to install the Docker apt signing key.',
  );
  await runRequiredShellCommand(
    rootCommandSpec,
    buildDockerSourcesWriteScript(distribution),
    'Failed to configure the Docker apt repository.',
  );
}

async function installDockerPackages(
  rootCommandSpec: RootCommandSpec,
  reportProgress?: InstallProgressReporter,
): Promise<void> {
  reportProgress?.('Installing Docker Engine packages...');
  await runRequiredCommand(
    rootCommandSpec,
    ['apt-get', 'update'],
    'Failed to refresh apt metadata after adding Docker.',
  );
  await runRequiredCommand(
    rootCommandSpec,
    ['apt-get', 'install', '-y', ...dockerPackages],
    'Failed to install Docker Engine packages.',
  );
}

function buildDockerSourcesWriteScript(distribution: SupportedDockerAptDistribution): string {
  const sourcesText: string = `Types: deb
URIs: https://download.docker.com/linux/${distribution.id}
Suites: ${distribution.codename}
Components: stable
Signed-By: ${dockerKeyringPath}`;
  return `cat <<'EOF' > ${dockerSourcesPath}
${sourcesText}
EOF`;
}

async function runRequiredShellCommand(
  rootCommandSpec: RootCommandSpec,
  script: string,
  failurePrefix: string,
): Promise<void> {
  await runRequiredCommand(rootCommandSpec, ['sh', '-lc', script], failurePrefix);
}

async function runRequiredCommand(
  rootCommandSpec: RootCommandSpec,
  command: readonly string[],
  failurePrefix: string,
): Promise<void> {
  const result: CommandResult = await runCappedCommand([...rootCommandSpec.commandPrefix, ...command]);
  if (result.exitCode === 0) {
    return;
  }

  throw createInstallError(failurePrefix, result);
}

function readSupportedDistributionCodename(osReleaseValues: OsReleaseValues): string {
  const codename: string | undefined = hasText(osReleaseValues.VERSION_CODENAME)
    ? osReleaseValues.VERSION_CODENAME
    : osReleaseValues.UBUNTU_CODENAME;
  if (hasText(codename)) {
    return codename;
  }

  throw new Error(
    'Unable to detect the Linux release codename needed for Docker installation. Install Docker manually and re-run `compartment install`.',
  );
}

function throwUnsupportedDistributionError(): never {
  throw new Error(
    'Automatic Docker installation is supported only on Ubuntu and Debian Linux hosts. Install Docker manually and re-run `compartment install`.',
  );
}

function createInstallError(prefix: string, result: CommandResult): Error {
  const outputText: string = readCommandOutput(result);
  if (hasText(outputText)) {
    return new Error(`${prefix}\n${outputText}`);
  }

  return new Error(prefix);
}
