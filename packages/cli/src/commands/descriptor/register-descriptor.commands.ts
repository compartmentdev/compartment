import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerDescriptorRoutesSchemaCommand } from './routes-schema.command';
import { registerDescriptorSchemaCommand } from './schema-descriptor.command';

export function registerDescriptorCommands(program: Command, dependencies: CliCommandDependencies): void {
  const descriptorCommand: Command = program.command('descriptor').description('Descriptor commands');
  registerDescriptorRoutesSchemaCommand(descriptorCommand, dependencies);
  registerDescriptorSchemaCommand(descriptorCommand, dependencies);
}
