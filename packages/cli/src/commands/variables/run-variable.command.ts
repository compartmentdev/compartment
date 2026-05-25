import { CommanderError, type Command } from 'commander';
import { defaultCompartmentEnvironmentName } from '@compartment/contracts';
import type { CommandResult } from '../../command-runner.types';
import { readPromptLine } from '../../prompts/prompt-reader';
import { resolveProjectTarget } from '../../services/project-target.service';
import type { ResolvedProjectTarget } from '../../services/projects.service.types';
import { runVariableCommand } from '../../services/variables.service';
import type { VariableScopeInput } from '../../services/variables.service.types';
import type { CliCommandDependencies, RunVariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createMutatingVariableScopeInput } from './variable.command.helpers';

const variableRunValueOptionFlags: readonly string[] = ['--project', '--env', '--service', '--resource'];
const variableRunConsumedValueOptionFlags: readonly string[] = [...variableRunValueOptionFlags, '--remote'];
const variableRunBooleanOptionFlags: readonly string[] = ['--allow-production'];

export function registerRunVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = addRemoteOption(program.command('run').argument('[child...]'));
  for (const optionFlag of variableRunValueOptionFlags) {
    command.option(`${optionFlag} <name>`);
  }
  for (const optionFlag of variableRunBooleanOptionFlags) {
    command.option(optionFlag);
  }

  command
    .description('Run a local command with runtime variables')
    .action(
      async (_childArguments: string[], options: RunVariableCommandOptions): Promise<void> =>
        await executeRunVariableCommand(dependencies, options),
    );
}

async function executeRunVariableCommand(
  dependencies: CliCommandDependencies,
  options: RunVariableCommandOptions,
): Promise<void> {
  const scopeInput: VariableScopeInput = await createMutatingVariableScopeInput(options);
  const childCommand: readonly string[] = readVariableRunChildCommand(dependencies.argv);
  await confirmProductionVariableRun(dependencies, options);
  const result: CommandResult = await runVariableCommand(
    await createRemoteAuthenticatedContext(options),
    {
      ...scopeInput,
      allowProduction: options.allowProduction === true,
      childCommand,
    },
    dependencies.io,
  );

  handleVariableRunResult(dependencies, result);
}

function handleVariableRunResult(dependencies: CliCommandDependencies, result: CommandResult): void {
  if (result.stderr.trim() !== '') {
    dependencies.io.stderr(`${result.stderr.trim()}\n`);
  }
  if (result.exitCode !== 0) {
    throw new CommanderError(result.exitCode, 'child_exit', '');
  }
}

async function confirmProductionVariableRun(
  dependencies: CliCommandDependencies,
  options: RunVariableCommandOptions,
): Promise<void> {
  if (
    options.env !== defaultCompartmentEnvironmentName ||
    options.allowProduction !== true ||
    !isTtyInput(dependencies.io.stdin)
  ) {
    return;
  }

  const target: ResolvedProjectTarget = await resolveProjectTarget(process.cwd(), options.project);
  const answer: string = (await readPromptLine(dependencies.io, buildProductionPrompt(target, options)))
    .trim()
    .toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Production variable run cancelled.');
  }
}

function buildProductionPrompt(target: ResolvedProjectTarget, options: RunVariableCommandOptions): string {
  const narrowedTargetLabel: string = readProductionPromptTargetLabel(options);
  return `Run command with production variables for project ${target.projectName}, environment ${defaultCompartmentEnvironmentName}${narrowedTargetLabel}? [y/N]: `;
}

function readProductionPromptTargetLabel(options: RunVariableCommandOptions): string {
  if (options.resource !== undefined) {
    return ` resource ${options.resource}`;
  }
  if (options.service !== undefined) {
    return ` service ${options.service}`;
  }

  return '';
}

function readVariableRunChildCommand(argv: readonly string[]): readonly string[] {
  const runIndex: number = findVariableRunIndex(argv);
  const delimiterIndex: number = argv.indexOf('--', runIndex + 1);
  if (delimiterIndex === -1) {
    throw new Error('Use -- before the command to run.');
  }
  if (hasVariableRunPositionalBeforeDelimiter(argv.slice(runIndex + 1, delimiterIndex))) {
    throw new Error('Use -- before the command to run.');
  }

  const childCommand: readonly string[] = argv.slice(delimiterIndex + 1);
  if (childCommand.length === 0) {
    throw new Error('Pass a command after --.');
  }

  return childCommand;
}

function hasVariableRunPositionalBeforeDelimiter(args: readonly string[]): boolean {
  for (let index: number = 0; index < args.length; index += 1) {
    const value: string | undefined = args[index];
    if (value === undefined || variableRunBooleanOptionFlags.includes(value)) {
      continue;
    }
    if (variableRunConsumedValueOptionFlags.includes(value)) {
      index += 1;
      continue;
    }
    if (isVariableRunAssignedValueOption(value)) {
      continue;
    }

    return !value.startsWith('--');
  }

  return false;
}

function isVariableRunAssignedValueOption(value: string): boolean {
  return variableRunConsumedValueOptionFlags.some((optionFlag: string): boolean => value.startsWith(`${optionFlag}=`));
}

function findVariableRunIndex(argv: readonly string[]): number {
  const runIndex: number = argv.findIndex(
    (value: string, index: number): boolean => value === 'run' && argv[index - 1] === 'variable',
  );
  if (runIndex === -1) {
    throw new Error('Expected variable run command.');
  }

  return runIndex;
}

function isTtyInput(input: NodeJS.ReadableStream): boolean {
  return (input as { isTTY?: boolean | undefined }).isTTY === true;
}
