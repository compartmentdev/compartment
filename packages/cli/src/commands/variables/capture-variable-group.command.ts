import type { Command } from 'commander';
import type { CaptureVariableGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { VariableScopeInput } from '../../services/variables.service.types';
import { captureVariableGroup } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupCaptureCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createMutatingVariableScopeInput } from './variable.command.helpers';
import { createCaptureVariableGroupMessage } from './variable-group.command.output';

export function registerCaptureVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('capture <name>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--effective')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (variableGroupName: string, options: VariableGroupCaptureCommandOptions): Promise<void> => {
    const scopeInput: VariableScopeInput = await createMutatingVariableScopeInput(options);
    const response: CaptureVariableGroupResponse = await captureVariableGroup(
      await createRemoteAuthenticatedContext(options),
      {
        ...scopeInput,
        effective: options.effective,
        variableGroupName,
      },
    );
    renderOutput(dependencies.io, options.output, response, createCaptureVariableGroupMessage(response));
  });
}
