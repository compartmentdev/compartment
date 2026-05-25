import { randomUUID } from 'node:crypto';
import { installSelfHosted } from '../../install';
import type { InstallContext, SelfHostedInstallPreflightOptions, SelfHostedInstallResult } from '../../install.types';
import type { CliCommandDependencies } from '../command.types';
import { createSelfHostedCommandContext } from '../self-hosted.command.context';
import {
  resolveSelfHostedInstallExecution as resolvePreparedSelfHostedInstallExecution,
  resolveSelfHostedInstallPreflightOptions,
} from './install.command.execution';
import { readInstallImageSelectionMessage } from './install.command.helpers';
import { resolveInstallIdentityPrompts } from './install.command.identity';
import type { InstallCommandProgress } from './install.command.progress.types';
import { renderPersistentInstallProgress } from './install.command.progress';
import {
  ensureInstallPublicPortsAvailable,
  resolveInstallPublicPorts,
  type InstallPublicPorts,
} from './install.command.public-ports';
import { persistSelfHostedInstallSessionIfNeeded, renderSelfHostedInstallResult } from './install.command.result';
import type {
  InstallCommandOptions,
  ResolvedInstallIdentityPrompts,
  ResolvedSelfHostedInstallExecution,
} from './install.command.types';
import type { InstallVersionSelection } from './install.command.options';

export async function runLocalSelfHostedInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  progress: InstallCommandProgress,
): Promise<void> {
  const installContext: InstallContext = createSelfHostedCommandContext(dependencies, (message: string): void =>
    progress.report(message),
  );
  const execution: ResolvedSelfHostedInstallExecution = await prepareLocalSelfHostedInstallExecution(
    dependencies,
    options,
    versionSelection,
    installContext,
    progress,
  );
  const result: SelfHostedInstallResult = await installSelfHosted({
    context: installContext,
    options: execution.selfHostedInstallOptions,
  });
  progress.stop();

  const sessionPersisted: boolean = await persistSelfHostedInstallSessionIfNeeded(options, result);
  renderSelfHostedInstallResult(dependencies, options, result, sessionPersisted);
}

async function prepareLocalSelfHostedInstallExecution(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  installContext: InstallContext,
  progress: InstallCommandProgress,
): Promise<ResolvedSelfHostedInstallExecution> {
  const publicPorts: InstallPublicPorts = await runSelfHostedInstallPreflight(
    dependencies,
    options,
    versionSelection,
    resolveInstallPublicPorts(options),
    installContext,
    progress,
  );
  progress.stop();

  return await resolveLocalSelfHostedInstallExecution(
    dependencies,
    options,
    versionSelection,
    publicPorts,
    randomUUID(),
    progress,
  );
}

async function runSelfHostedInstallPreflight(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installContext: InstallContext,
  progress: InstallCommandProgress,
): Promise<InstallPublicPorts> {
  progress.report('Validating install prerequisites...');
  const resolvedPublicPorts: InstallPublicPorts = await ensureInstallPublicPortsAvailable(
    dependencies,
    options,
    versionSelection,
    publicPorts,
    installContext,
    progress,
  );
  reportInstallImageSelection(dependencies, options, versionSelection, resolvedPublicPorts, progress);
  return resolvedPublicPorts;
}

function reportInstallImageSelection(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  progress: InstallCommandProgress,
): void {
  const preflightOptions: SelfHostedInstallPreflightOptions = resolveSelfHostedInstallPreflightOptions(
    options,
    versionSelection,
    publicPorts,
  );
  renderPersistentInstallProgress(
    dependencies.io,
    options,
    progress,
    readInstallImageSelectionMessage(preflightOptions, versionSelection),
  );
}

async function resolveLocalSelfHostedInstallExecution(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installationId: string,
  progress: InstallCommandProgress,
): Promise<ResolvedSelfHostedInstallExecution> {
  progress.stop();
  const identityPrompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  return await resolvePreparedSelfHostedInstallExecution(
    options,
    versionSelection,
    publicPorts,
    installationId,
    identityPrompts,
    progress,
  );
}
