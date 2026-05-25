import type { Command } from 'commander';
import type { ResourceTargetInput } from '../../services/resources.service.types';
import type { EnvironmentCommandOptions } from '../command.types';

export interface ResourceCommandOptions extends EnvironmentCommandOptions {
  as?: string | undefined;
  backup?: string | undefined;
  deleteData?: boolean | undefined;
  resource?: string | undefined;
  reveal?: boolean | undefined;
  since?: string | undefined;
  tail?: string | undefined;
  yes?: boolean | undefined;
}

export function createResourceTargetInput(options: ResourceCommandOptions): ResourceTargetInput {
  return {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    resourceName: options.resource!,
  };
}

export function createNamedResourceCommand(program: Command, commandName: string): Command {
  return program
    .command(commandName)
    .requiredOption('--resource <name>')
    .option('--project <name>')
    .option('--env <name>')
    .option('--output <format>', 'text or json', 'text');
}
