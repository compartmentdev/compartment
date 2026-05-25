import type { Command } from 'commander';
import type { CreateCliAppOptions } from './app.types';
import { createCliProgram } from './create-cli-program';
import type { CliHelpTreeNode } from './help-tree.types';

export function createCliHelpTree(options: CreateCliAppOptions = {}): CliHelpTreeNode {
  return createCliHelpTreeNode(createCliProgram(options), []);
}

function createCliHelpTreeNode(command: Command, pathSegments: readonly string[]): CliHelpTreeNode {
  const subcommands: readonly CliHelpTreeNode[] = readVisibleSubcommands(command).map(
    (subcommand: Command): CliHelpTreeNode => createCliHelpTreeNode(subcommand, [...pathSegments, subcommand.name()]),
  );

  return {
    helpText: command.helpInformation().trimEnd(),
    pathSegments,
    subcommands,
  };
}

function readVisibleSubcommands(command: Command): Command[] {
  return command.commands.filter((subcommand: Command): boolean => subcommand.name() !== 'help');
}
