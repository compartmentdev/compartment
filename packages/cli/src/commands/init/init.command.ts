import { basename } from 'node:path';
import type { Command } from 'commander';
import type { CompartmentInitResult } from '@compartment/contracts';
import { hasText } from '@compartment/utils';

import { renderOutput } from '../../output/render';
import { promptProjectName } from '../../prompts/prompt';
import { deriveSuggestedProjectName, initializeProject } from '../../services/init.service';
import type { CliCommandDependencies, InitCommandOptions } from '../command.types';

export function registerInitCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('init')
    .option('--name <slug>', 'Project name slug')
    .option('--output <format>', 'text or json', 'text')
    .action(async (options: InitCommandOptions): Promise<void> => await executeInitCommand(dependencies, options));
}

async function executeInitCommand(dependencies: CliCommandDependencies, options: InitCommandOptions): Promise<void> {
  const cwd: string = process.cwd();
  const projectName: string = await resolveProjectName(dependencies, options, cwd);
  const result: CompartmentInitResult = await initializeProject({
    cwd,
    name: projectName,
  });

  renderOutput(dependencies.io, options.output, result, createInitResultMessage(result));
}

function createInitResultMessage(result: CompartmentInitResult): string {
  return `Created ${result.file} for ${result.descriptor.name}. Initialized service web -> .
Need the full compartment.yml schema? Run: compartment descriptor schema`;
}

async function resolveProjectName(
  dependencies: CliCommandDependencies,
  options: InitCommandOptions,
  cwd: string,
): Promise<string> {
  if (hasText(options.name)) {
    return options.name;
  }

  const suggestedName: string | undefined = deriveSuggestedProjectName(cwd);
  if (isInteractiveInput(dependencies.io.stdin)) {
    return await promptProjectName(dependencies.io, suggestedName);
  }

  if (hasText(suggestedName)) {
    return suggestedName;
  }

  throw new Error(
    `Could not derive a valid project name from directory "${basename(cwd)}". Re-run with --name <slug>.`,
  );
}

function isInteractiveInput(input: NodeJS.ReadableStream): boolean {
  const ttyInput: Partial<NodeJS.ReadableStream> & { isTTY?: boolean | undefined } = input;
  return ttyInput.isTTY === true;
}
