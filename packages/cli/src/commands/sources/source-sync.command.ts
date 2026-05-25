import type { GitSourceSyncTask } from '@compartment/contracts';
import type { Command } from 'commander';
import type { AuthenticatedContext } from '../../services/context.types';
import { startGitSourceSync } from '../../services/sources.service';
import type { CliCommandDependencies, SourceSyncCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import {
  createCompletedGitSourceSyncMessage,
  readTerminalSyncFailureMessage,
  waitForGitSourceSyncTask,
} from './source-sync.command.support';

export function registerSourceSyncCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('sync <sourceId>')).action(
    async (sourceId: string, options: SourceSyncCommandOptions): Promise<void> => {
      await runSourceSyncCommand(dependencies, sourceId, options);
    },
  );
}

async function runSourceSyncCommand(
  dependencies: CliCommandDependencies,
  sourceId: string,
  options: SourceSyncCommandOptions,
): Promise<void> {
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
  const startedTask: GitSourceSyncTask = (await startGitSourceSync(context, sourceId)).task;
  const completedTask: GitSourceSyncTask = await waitForGitSourceSyncTask(context, sourceId, startedTask);
  handleCompletedGitSourceSyncTask(dependencies, sourceId, completedTask);
}

function handleCompletedGitSourceSyncTask(
  dependencies: CliCommandDependencies,
  sourceId: string,
  task: GitSourceSyncTask,
): void {
  if (task.status === 'failed' || task.status === 'canceled') {
    throw new Error(readTerminalSyncFailureMessage(sourceId, task));
  }

  dependencies.io.stdout(`${createCompletedGitSourceSyncMessage(sourceId, task)}\n`);
}
