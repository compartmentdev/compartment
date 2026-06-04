import type { CommandResult } from './command-runner.types';
import { runInheritedCommand } from './command-runner';
import { runDockerCommand, runQuietDockerCommand } from './docker-command';
import { assertSupportedSelfHostedDockerEngineVersion } from './docker-engine-version';
import {
  readDockerExecutionContextMessage,
  readDockerExecutionSwitchMessage,
  readInteractiveSudoProbeMessage,
  readMissingDockerInstallMessage,
} from './docker-execution-context.messages';
import { inheritedCommandProgressReportOptions } from './docker-progress';
import { installDockerEngine } from './docker-install';
import type {
  DockerExecutionContext,
  DockerExecutionMode,
  EnsureDockerExecutionContextOptions,
} from './docker-runtime.types';

const dockerInfoSecurityOptionsArguments: readonly string[] = ['info', '--format', '{{json .SecurityOptions}}'];
const dockerServerVersionArguments: readonly string[] = ['version', '--format', '{{.Server.Version}}'];

interface DockerExecutionProbe {
  composeResult: CommandResult;
  context: DockerExecutionContext;
  daemonResult?: CommandResult | undefined;
}

interface ReadyDockerExecutionProbe {
  context: DockerExecutionContext;
  kind: 'ready';
}

interface MissingDockerExecutionProbe {
  kind: 'missing';
}

interface UnavailableDockerExecutionProbe {
  interactiveSudoTried: boolean;
  kind: 'unavailable';
}

type DockerExecutionProbeResult =
  | MissingDockerExecutionProbe
  | ReadyDockerExecutionProbe
  | UnavailableDockerExecutionProbe;

export async function ensureDockerExecutionContext(
  options?: EnsureDockerExecutionContextOptions,
): Promise<DockerExecutionContext> {
  const probeResult: DockerExecutionProbeResult = await probeDockerExecutionContext(options);
  if (probeResult.kind === 'ready') {
    return probeResult.context;
  }

  if (probeResult.kind === 'missing' && options?.installWhenMissing === true) {
    if ((await options.confirmInstallWhenMissing?.()) !== true) {
      throw new Error(readMissingDockerInstallMessage(options.confirmInstallWhenMissing !== undefined));
    }

    await installDockerEngine(options.reportProgress);
    return await requireDockerExecutionContextAfterInstall(options);
  }

  throw new Error(readDockerExecutionContextMessage(probeResult));
}

async function requireDockerExecutionContextAfterInstall(
  options: EnsureDockerExecutionContextOptions | undefined,
): Promise<DockerExecutionContext> {
  const installedProbe: DockerExecutionProbeResult = await probeDockerExecutionContext(options);
  if (installedProbe.kind === 'ready') {
    return installedProbe.context;
  }

  throw new Error(readDockerExecutionContextMessage(installedProbe));
}

async function probeDockerExecutionContext(
  options: EnsureDockerExecutionContextOptions | undefined,
): Promise<DockerExecutionProbeResult> {
  const directProbe: DockerExecutionProbe = await runDockerExecutionProbe(createDockerExecutionContext('direct'));
  if (probeSucceeded(directProbe)) {
    return createReadyDockerExecutionProbe(directProbe);
  }

  const passwordlessSudoProbe: DockerExecutionProbe = await runDockerExecutionProbe(
    createDockerExecutionContext('sudo-n'),
  );
  if (probeSucceeded(passwordlessSudoProbe)) {
    return createResolvedDockerExecutionProbe(options, 'sudo-n', directProbe, passwordlessSudoProbe);
  }

  return await resolveInteractiveSudoDockerExecutionProbe(options, directProbe, passwordlessSudoProbe);
}

async function resolveInteractiveSudoDockerExecutionProbe(
  options: EnsureDockerExecutionContextOptions | undefined,
  directProbe: DockerExecutionProbe,
  passwordlessSudoProbe: DockerExecutionProbe,
): Promise<DockerExecutionProbeResult> {
  if (options?.allowInteractiveSudo !== true) {
    return readUnavailableDockerExecutionProbe([directProbe, passwordlessSudoProbe], false);
  }

  options.reportProgress?.(
    readInteractiveSudoProbeMessage(directProbe.composeResult.exitCode),
    inheritedCommandProgressReportOptions,
  );
  if (!(await validateInteractiveSudoAccess())) {
    return readUnavailableDockerExecutionProbe([directProbe, passwordlessSudoProbe], true);
  }

  const interactiveSudoProbe: DockerExecutionProbe = await runValidatedSudoDockerExecutionProbe();
  if (probeSucceeded(interactiveSudoProbe)) {
    return createReadyDockerExecutionProbe(interactiveSudoProbe);
  }

  return readUnavailableDockerExecutionProbe([directProbe, passwordlessSudoProbe, interactiveSudoProbe], true);
}

async function validateInteractiveSudoAccess(): Promise<boolean> {
  const validateSudoResult: CommandResult = await runInheritedCommand(['sudo', '-v']);
  return validateSudoResult.exitCode === 0;
}

async function runDockerExecutionProbe(context: DockerExecutionContext): Promise<DockerExecutionProbe> {
  const composeResult: CommandResult = await runDockerCommand(context, ['compose', 'version']);
  if (composeResult.exitCode !== 0) {
    return {
      composeResult,
      context,
    };
  }

  const daemonProbe: Pick<DockerExecutionProbe, 'daemonResult'> = await readDockerDaemonProbe(
    context,
    runDockerCommand,
  );
  return {
    composeResult,
    context,
    ...daemonProbe,
  };
}

async function runValidatedSudoDockerExecutionProbe(): Promise<DockerExecutionProbe> {
  const context: DockerExecutionContext = createDockerExecutionContext('sudo');
  const composeResult: CommandResult = await runQuietDockerCommand(context, ['compose', 'version']);
  if (composeResult.exitCode !== 0) {
    return {
      composeResult,
      context,
    };
  }

  const daemonProbe: Pick<DockerExecutionProbe, 'daemonResult'> = await readDockerDaemonProbe(
    context,
    runQuietDockerCommand,
  );
  return {
    composeResult,
    context,
    ...daemonProbe,
  };
}

async function readDockerDaemonProbe(
  context: DockerExecutionContext,
  runCommand: (context: DockerExecutionContext, args: readonly string[]) => Promise<CommandResult>,
): Promise<Pick<DockerExecutionProbe, 'daemonResult'>> {
  const daemonResult: CommandResult = await runCommand(context, [...dockerInfoSecurityOptionsArguments]);
  if (daemonResult.exitCode !== 0) {
    return {
      daemonResult,
    };
  }

  const versionResult: CommandResult = await runCommand(context, [...dockerServerVersionArguments]);
  const versionOutput: string = versionResult.exitCode === 0 ? versionResult.stdout : '';
  assertSupportedSelfHostedDockerEngineVersion(versionOutput);
  return {
    daemonResult,
  };
}

function createDockerExecutionContext(
  mode: DockerExecutionMode,
  isRootlessDocker: boolean = false,
): DockerExecutionContext {
  if (mode === 'direct') {
    return { dockerCommand: ['docker'], isRootlessDocker, mode };
  }

  const dockerCommand: readonly string[] = mode === 'sudo-n' ? ['sudo', '-n', 'docker'] : ['sudo', 'docker'];
  return { dockerCommand, isRootlessDocker, mode };
}

function probeSucceeded(probe: DockerExecutionProbe): boolean {
  return probe.composeResult.exitCode === 0 && probe.daemonResult?.exitCode === 0;
}

function readUnavailableDockerExecutionProbe(
  probes: readonly DockerExecutionProbe[],
  interactiveSudoTried: boolean,
): DockerExecutionProbeResult {
  if (!probes.some((probe: DockerExecutionProbe): boolean => probe.composeResult.exitCode === 0)) {
    return { kind: 'missing' };
  }

  return {
    interactiveSudoTried,
    kind: 'unavailable',
  };
}

function createResolvedDockerExecutionProbe(
  options: EnsureDockerExecutionContextOptions | undefined,
  mode: DockerExecutionMode,
  directProbe: DockerExecutionProbe,
  resolvedProbe: DockerExecutionProbe,
): ReadyDockerExecutionProbe {
  options?.reportProgress?.(readDockerExecutionSwitchMessage(mode, directProbe.composeResult.exitCode));
  return createReadyDockerExecutionProbe(resolvedProbe);
}

function createReadyDockerExecutionProbe(probe: DockerExecutionProbe): ReadyDockerExecutionProbe {
  return {
    context: {
      ...probe.context,
      isRootlessDocker: readRootlessDocker(probe.daemonResult),
    },
    kind: 'ready',
  };
}

function readRootlessDocker(daemonResult: CommandResult | undefined): boolean {
  if (daemonResult?.exitCode !== 0) {
    return false;
  }

  return daemonResult.stdout.includes('name=rootless');
}
