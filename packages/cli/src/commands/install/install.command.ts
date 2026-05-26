import { Option, type Command } from 'commander';
import { renderOutput } from '../../output/render';
import { installDev } from '../../install';
import type { SelfHostedInstallResult } from '../../install.types';
import { assertNodeAgentHostServiceInstallable } from '../../node-agent-service';
import type { CliCommandDependencies, CliIoCommandDependencies } from '../command.types';
import { shouldUseTerminalStyles } from '../terminal-style.helpers';
import { persistDevInstallSession, persistInstallSession } from './install.command.session';
import { rerunSelfHostedInstallCommandWithSudoIfNeeded } from './install.command.sudo';
import { createSelfHostedInstallResultMessage, toInstallResponse } from './install.command.helpers';
import {
  assertInstallVersionMatchesPackagedNodeAgent,
  assertInstallModeSelection,
  assertInstallOptionValues,
  readInstallImageSource,
  resolveInstallVersionSelection,
  type InstallVersionSelection,
} from './install.command.options';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';
import { resolveInstallIdentityPrompts } from './install.command.identity';
import { runLocalSelfHostedInstallCommand } from './install.command.local';
import { createInstallCommandProgress } from './install.command.progress';
import type { InstallCommandProgress } from './install.command.progress.types';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('install')
    .option('--dev', 'Install against the local repo dev API')
    .option('--email <email>', 'First admin email')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for --dev session persistence')
    .option('--base-domain <domain>')
    .option('--managed-domain', 'Allocate a managed install domain through the broker')
    .option('--broker-url <url>')
    .option('--local-runtime', 'Install the full self-hosted Docker runtime with local browser hosts')
    .option('--image-source <source>', 'registry or local')
    .option('--image-registry <registry>', 'github or docker-hub')
    .option('--public-http-port <port>')
    .option('--public-https-port <port>')
    .option('--version <version>', 'runtime tag; registry installs must match the packaged CLI node-agent')
    .option('--output <format>', 'text or json', 'text')
    .addOption(new Option('--skip-session-persist').hideHelp())
    .addOption(new Option('--internal-install-result').hideHelp())
    .action(
      async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
    );
}

async function executeInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  assertInstallModeSelection(options);
  assertInstallOptionValues(options);

  if (options.dev === true) {
    await executeDevInstallCommand(dependencies, options);
    return;
  }

  await executeSelfHostedInstallCommand(dependencies, options);
}

async function executeDevInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  const result: SelfHostedInstallResult = await installDev({
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
    ...(options.organizationSlug !== undefined ? { organizationSlug: options.organizationSlug } : {}),
  });

  await persistDevInstallSession(result, options.remote);
  renderOutput(
    dependencies.io,
    options.output,
    toInstallResponse(result),
    createSelfHostedInstallResultMessage(result, true, shouldUseTerminalStyles(dependencies.io, 'stdout')),
  );
}

async function executeSelfHostedInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const versionSelection: InstallVersionSelection = resolveInstallVersionSelectionForInstall(options);
  assertNodeAgentHostServiceInstallable();
  const sudoResult: SelfHostedInstallResult | undefined =
    await rerunSelfHostedInstallCommandWithSudoIfNeeded(dependencies);
  if (sudoResult !== undefined) {
    await completeSudoSelfHostedInstallCommand(dependencies, options, sudoResult);
    return;
  }

  await executeLocalSelfHostedInstallCommand(dependencies, options, versionSelection);
}

async function completeSudoSelfHostedInstallCommand(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
  result: SelfHostedInstallResult,
): Promise<void> {
  await persistInstallSession(result);
  renderOutput(
    dependencies.io,
    options.output,
    toInstallResponse(result),
    createSelfHostedInstallResultMessage(result, true, shouldUseTerminalStyles(dependencies.io, 'stdout')),
  );
}

async function executeLocalSelfHostedInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
): Promise<void> {
  const progress: InstallCommandProgress = createInstallCommandProgress({ io: dependencies.io, options });

  try {
    await runLocalSelfHostedInstallCommand(dependencies, options, versionSelection, progress);
  } finally {
    progress.stop();
  }
}

function resolveInstallVersionSelectionForInstall(options: InstallCommandOptions): InstallVersionSelection {
  const versionSelection: InstallVersionSelection = resolveInstallVersionSelection(options.version);
  if (readInstallImageSource(options.imageSource) === 'registry') {
    assertInstallVersionMatchesPackagedNodeAgent(versionSelection);
  }

  return versionSelection;
}
