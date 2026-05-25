import type { Command } from 'commander';
import { bindVariableGroup } from '../../services/variable-groups.service';
import type { CliCommandDependencies } from '../command.types';
import { registerVariableGroupBindingCommand } from './variable-group-binding.command.helpers';
import { createBindVariableGroupMessage } from './variable-group.command.output';

export function registerBindVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerVariableGroupBindingCommand(program, dependencies, {
    commandName: 'bind',
    createMessage: createBindVariableGroupMessage,
    execute: bindVariableGroup,
    requireDeclaredResourceTarget: true,
  });
}
