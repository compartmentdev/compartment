import { updateResponseSchema, type UpdateResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { assertNodeAgentHostServiceInstallable } from '../../node-agent-service';
import { updateSelfHosted } from '../../update';
import type { SelfHostedUpdateOptions, SelfHostedUpdateResult } from '../../update.types';
import type { CliCommandDependencies, CliIoCommandDependencies } from '../command.types';
import { createCommandProgress } from '../command.progress';
import type { CommandProgress } from '../command.progress.types';
import { createSelfHostedCommandContext } from '../self-hosted.command.context';
import type { InstallImageSource } from '../../install.types';
import type { SelfHostedRuntimeImageRegistry } from '../../self-hosted-env.types';
import {
  assertSelfHostedVersionMatchesPackagedNodeAgent,
  readOptionalSelfHostedImageRegistry,
  readSelfHostedImageSource,
  resolveSelfHostedVersionSelection,
  type SelfHostedVersionSelection,
} from '../self-hosted.command.options';
import { createSelfHostedUpdateResultMessage } from './system.command.helpers';
import { executeSelfHostedSystemCommandWithSudoFallback } from './system.command.sudo';
import type { UpdateCommandOptions } from './system.command.types';

export function registerUpdateSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('update')
    .option('--image-source <source>', 'registry or local')
    .option('--image-registry <registry>', 'github or docker-hub')
    .option('--version <version>', 'runtime tag; registry updates must match the packaged CLI node-agent')
    .option('--output <format>', 'text or json', 'text')
    .action(async (options: UpdateCommandOptions): Promise<void> => await executeUpdateCommand(dependencies, options));
}

async function executeUpdateCommand(
  dependencies: CliCommandDependencies,
  options: UpdateCommandOptions,
): Promise<void> {
  assertUpdateCommandBoundaryOptions(options);
  assertNodeAgentHostServiceInstallable();
  await executeSelfHostedSystemCommandWithSudoFallback(
    dependencies,
    async (): Promise<void> => await executeUpdateCommandLocally(dependencies, options),
  );
}

function assertUpdateCommandBoundaryOptions(options: UpdateCommandOptions): void {
  const imageSource: InstallImageSource | undefined =
    options.imageSource === undefined ? undefined : readSelfHostedImageSource(options.imageSource);
  readOptionalSelfHostedImageRegistry(options.imageRegistry);
  const versionSelection: SelfHostedVersionSelection = resolveSelfHostedVersionSelection(options.version);
  if (imageSource === 'registry') {
    assertSelfHostedVersionMatchesPackagedNodeAgent(versionSelection);
  }
}

async function executeUpdateCommandLocally(
  dependencies: CliIoCommandDependencies,
  options: UpdateCommandOptions,
): Promise<void> {
  const versionSelection: SelfHostedVersionSelection = resolveSelfHostedVersionSelection(options.version);
  const updateOptions: SelfHostedUpdateOptions = readSelfHostedUpdateOptions(options, versionSelection);
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });

  try {
    const result: SelfHostedUpdateResult = await updateSelfHosted({
      context: createSelfHostedCommandContext(dependencies, (message: string): void => progress.report(message)),
      options: updateOptions,
    });
    const payload: UpdateResponse = updateResponseSchema.parse(result);

    progress.stop();
    renderOutput(dependencies.io, options.output, payload, createSelfHostedUpdateResultMessage(result));
  } finally {
    progress.stop();
  }
}

function readSelfHostedUpdateOptions(
  options: UpdateCommandOptions,
  versionSelection: SelfHostedVersionSelection,
): SelfHostedUpdateOptions {
  const imageSource: InstallImageSource | undefined =
    options.imageSource === undefined ? undefined : readSelfHostedImageSource(options.imageSource);
  const imageRegistry: SelfHostedRuntimeImageRegistry | undefined = readOptionalSelfHostedImageRegistry(
    options.imageRegistry,
  );

  return {
    ...(imageRegistry !== undefined ? { imageRegistry } : {}),
    ...(imageSource !== undefined ? { imageSource } : {}),
    version: versionSelection.value,
  };
}
