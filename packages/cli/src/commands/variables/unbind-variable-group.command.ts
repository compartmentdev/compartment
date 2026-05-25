import type { Command } from 'commander';
import { unbindVariableGroup } from '../../services/variable-groups.service';
import type { CliCommandDependencies } from '../command.types';
import { registerVariableGroupBindingCommand } from './variable-group-binding.command.helpers';
import { createUnbindVariableGroupMessage } from './variable-group.command.output';

export function registerUnbindVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerVariableGroupBindingCommand(program, dependencies, {
    commandName: 'unbind',
    createMessage: createUnbindVariableGroupMessage,
    execute: unbindVariableGroup,
    requireDeclaredResourceTarget: false,
  });
}
