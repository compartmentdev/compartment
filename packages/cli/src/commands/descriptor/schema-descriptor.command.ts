import type { Command } from 'commander';
import {
  createCompartmentDescriptorSchemaResponse,
  compartmentDescriptorSchemaResponseSchema,
  type CompartmentDescriptorSchemaResponse,
} from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createCompartmentDescriptorSchemaMessage } from '../../services/compartment-descriptor-schema-output.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';

export function registerDescriptorSchemaCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('schema')
    .description('Show the compartment.yml contract and examples')
    .option('--output <format>', 'text or json', 'text')
    .action((options: OutputOnlyOptions): void => executeDescriptorSchemaCommand(dependencies, options));
}

function executeDescriptorSchemaCommand(dependencies: CliCommandDependencies, options: OutputOnlyOptions): void {
  const response: CompartmentDescriptorSchemaResponse = compartmentDescriptorSchemaResponseSchema.parse(
    createCompartmentDescriptorSchemaResponse(),
  );
  renderOutput(dependencies.io, options.output, response, createCompartmentDescriptorSchemaMessage(response));
}
