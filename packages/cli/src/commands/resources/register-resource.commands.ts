import {
  logTailLineLimit as maxLogTailLines,
  type ResourceDeleteResponse,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowResponse,
  type ResourceListResponse,
  type ResourceLogsResponse,
  type ResourceResponse,
  type ResourceRestoreAsResponse,
  type ResourceRestoreResponse,
} from '@compartment/contracts';
import { Option, type Command } from 'commander';
import { renderOutput } from '../../output/render';
import { isInteractivePromptInput, readPromptLine } from '../../prompts/prompt-reader';
import {
  deleteResource,
  bootstrapResource,
  createResourceBackup,
  inspectResource,
  listResourceBackups,
  listResources,
  readResourceLogs,
  restoreResourceBackup,
  showResourceBackup,
  startResource,
  stopResource,
} from '../../services/resources.service';
import type { ResourceRestoreBaseInput, ResourceRestoreInput } from '../../services/resources.service.types';
import type { CliCommandDependencies } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import {
  createResourceListMessage,
  createResourceDeleteMessage,
  createResourceBackupCreateMessage,
  createResourceBackupListMessage,
  createResourceBackupShowMessage,
  createResourceLogsMessage,
  createResourceResponseMessage,
  createResourceRestoreMessage,
} from './resource.command.output';
import { registerOutputCommands } from './register-resource-output.commands';
import {
  createNamedResourceCommand,
  createResourceTargetInput,
  type ResourceCommandOptions,
} from './resource-command.helpers';

export function registerResourceCommands(program: Command, dependencies: CliCommandDependencies): void {
  const resourceCommand: Command = program.command('resource').description('Resource commands');
  registerListCommand(resourceCommand, dependencies);
  registerTargetCommand(resourceCommand, 'inspect', inspectResource, dependencies);
  registerTargetCommand(resourceCommand, 'bootstrap', bootstrapResource, dependencies);
  registerLogsCommand(resourceCommand, dependencies);
  registerOutputCommands(resourceCommand, dependencies);
  registerTargetCommand(resourceCommand, 'start', startResource, dependencies);
  registerTargetCommand(resourceCommand, 'stop', stopResource, dependencies);
  registerDeleteCommand(resourceCommand, dependencies);
  registerBackupCommands(resourceCommand, dependencies);
}

function registerListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('list')
      .option('--project <name>')
      .option('--env <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    const response: ResourceListResponse = await listResources(await createRemoteAuthenticatedContext(options), {
      cwd: process.cwd(),
      environmentName: options.env,
      projectName: options.project,
    });
    renderOutput(dependencies.io, options.output, response, createResourceListMessage(response));
  });
}

function registerTargetCommand(
  program: Command,
  name: string,
  action: typeof inspectResource,
  dependencies: CliCommandDependencies,
): void {
  addRemoteOption(
    program
      .command(name)
      .requiredOption('--resource <name>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    const response: ResourceResponse = await action(
      await createRemoteAuthenticatedContext(options),
      createResourceTargetInput(options),
    );
    renderOutput(dependencies.io, options.output, response, createResourceResponseMessage(response));
  });
}

function registerLogsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('logs')
      .requiredOption('--resource <name>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--since <iso>')
      .option('--tail <lines>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    const response: ResourceLogsResponse = await readResourceLogs(await createRemoteAuthenticatedContext(options), {
      ...createResourceTargetInput(options),
      ...(options.since !== undefined ? { since: options.since } : {}),
      ...(options.tail !== undefined ? { tailLines: parseTailLines(options.tail) } : {}),
    });
    renderOutput(dependencies.io, options.output, response, createResourceLogsMessage(response));
  });
}

function registerDeleteCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('delete')
      .requiredOption('--resource <name>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--delete-data')
      .addOption(new Option('--yes', 'confirm resource data deletion').hideHelp())
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    await confirmResourceDataDelete(dependencies, options);
    const response: ResourceDeleteResponse = await deleteResource(await createRemoteAuthenticatedContext(options), {
      ...createResourceTargetInput(options),
      deleteData: options.deleteData,
    });
    renderOutput(dependencies.io, options.output, response, createResourceDeleteMessage(response));
  });
}

async function confirmResourceDataDelete(
  dependencies: CliCommandDependencies,
  options: ResourceCommandOptions,
): Promise<void> {
  if (options.deleteData !== true || options.yes === true) {
    return;
  }
  if (!isInteractivePromptInput(dependencies.io.stdin)) {
    throw new Error('Resource data delete requires interactive confirmation.');
  }

  const answer: string = (await readPromptLine(dependencies.io, buildResourceDataDeletePrompt(options)))
    .trim()
    .toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Resource data delete cancelled.');
  }
}

function buildResourceDataDeletePrompt(options: ResourceCommandOptions): string {
  return `Delete data volumes for resource ${options.resource!}. Are you sure? [y/N]: `;
}

function registerBackupCommands(program: Command, dependencies: CliCommandDependencies): void {
  const backupCommand: Command = program.command('backup').description('Resource backup commands');
  registerBackupCreateCommand(backupCommand, dependencies);
  registerBackupListCommand(backupCommand, dependencies);
  registerBackupShowCommand(backupCommand, dependencies);
  registerBackupRestoreCommand(backupCommand, dependencies);
}

function registerBackupCreateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(createNamedResourceCommand(program, 'create')).action(
    async (options: ResourceCommandOptions): Promise<void> => {
      const response: ResourceBackupCreateResponse = await createResourceBackup(
        await createRemoteAuthenticatedContext(options),
        createResourceTargetInput(options),
      );
      renderOutput(dependencies.io, options.output, response, createResourceBackupCreateMessage(response));
    },
  );
}

function registerBackupListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(createNamedResourceCommand(program, 'list')).action(
    async (options: ResourceCommandOptions): Promise<void> => {
      const response: ResourceBackupListResponse = await listResourceBackups(
        await createRemoteAuthenticatedContext(options),
        createResourceTargetInput(options),
      );
      renderOutput(dependencies.io, options.output, response, createResourceBackupListMessage(response));
    },
  );
}

function registerBackupShowCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('show')
      .requiredOption('--backup <backup-id>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    const response: ResourceBackupShowResponse = await showResourceBackup(
      await createRemoteAuthenticatedContext(options),
      {
        backupId: options.backup!,
        cwd: process.cwd(),
        environmentName: options.env,
        projectName: options.project,
      },
    );
    renderOutput(dependencies.io, options.output, response, createResourceBackupShowMessage(response));
  });
}

function registerBackupRestoreCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('restore')
      .option('--resource <name>')
      .requiredOption('--backup <backup-id>')
      .option('--as <name>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--yes')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ResourceCommandOptions): Promise<void> => {
    const response: ResourceRestoreResponse | ResourceRestoreAsResponse = await restoreResourceBackup(
      await createRemoteAuthenticatedContext(options),
      createRestoreInput(options),
    );
    renderOutput(dependencies.io, options.output, response, createResourceRestoreMessage(response));
  });
}

function createRestoreInput(options: ResourceCommandOptions): ResourceRestoreInput {
  if (options.as !== undefined && options.resource !== undefined) {
    throw new Error('Resource backup restore cannot use --resource with --as.');
  }

  const input: ResourceRestoreBaseInput = {
    backupId: options.backup!,
    confirmed: options.yes,
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
  };
  if (options.as !== undefined) {
    return { ...input, targetResourceName: options.as };
  }
  if (options.resource === undefined) {
    throw new Error('Resource restore requires --resource unless --as is provided.');
  }

  return { ...input, resourceName: options.resource };
}

function parseTailLines(value: string): number {
  const tailLines: number = Number(value);
  if (Number.isInteger(tailLines) && tailLines > 0 && tailLines <= maxLogTailLines) {
    return tailLines;
  }

  throw new Error(`--tail must be a positive integer up to ${maxLogTailLines}.`);
}
