import type { Command } from 'commander';
import {
  createCompartmentRoutesSchemaResponse,
  compartmentRoutesSchemaResponseSchema,
  type CompartmentRoutesSchemaResponse,
} from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createCompartmentRoutesSchemaMessage } from '../../services/compartment-routes-schema-output.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';

export function registerDescriptorRoutesSchemaCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('routes-schema')
    .description('Show the compartment.routes.yml contract and examples')
    .option('--output <format>', 'text or json', 'text')
    .action((options: OutputOnlyOptions): void => executeDescriptorRoutesSchemaCommand(dependencies, options));
}

function executeDescriptorRoutesSchemaCommand(dependencies: CliCommandDependencies, options: OutputOnlyOptions): void {
  const response: CompartmentRoutesSchemaResponse = compartmentRoutesSchemaResponseSchema.parse(
    createCompartmentRoutesSchemaResponse(),
  );
  renderOutput(dependencies.io, options.output, response, createCompartmentRoutesSchemaMessage(response));
}
