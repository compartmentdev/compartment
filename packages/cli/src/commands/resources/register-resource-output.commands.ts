import type { ResourceOutputListResponse, ResourceOutputResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { listResourceOutputs, showResourceOutput } from '../../services/resources.service';
import type { CliCommandDependencies } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createResourceOutputListMessage, createResourceOutputShowMessage } from './resource.command.output';
import {
  createNamedResourceCommand,
  createResourceTargetInput,
  type ResourceCommandOptions,
} from './resource-command.helpers';

export function registerOutputCommands(program: Command, dependencies: CliCommandDependencies): void {
  const outputCommand: Command = program.command('output').description('Resource output commands');
  registerOutputListCommand(outputCommand, dependencies);
  registerOutputShowCommand(outputCommand, dependencies);
}

function registerOutputListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(createNamedResourceCommand(program, 'list')).action(
    async (options: ResourceCommandOptions): Promise<void> => {
      const response: ResourceOutputListResponse = await listResourceOutputs(
        await createRemoteAuthenticatedContext(options),
        createResourceTargetInput(options),
      );
      renderOutput(dependencies.io, options.output, response, createResourceOutputListMessage(response));
    },
  );
}

function registerOutputShowCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(createNamedResourceCommand(program, 'show <name>').option('--reveal')).action(
    async (outputName: string, options: ResourceCommandOptions): Promise<void> => {
      const response: ResourceOutputResponse = await showResourceOutput(
        await createRemoteAuthenticatedContext(options),
        {
          ...createResourceTargetInput(options),
          outputName,
          reveal: options.reveal,
        },
      );
      renderOutput(dependencies.io, options.output, response, createResourceOutputShowMessage(response));
    },
  );
}
