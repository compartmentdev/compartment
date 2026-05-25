import type { GitSourceSyncTask } from '@compartment/contracts';
import type { Command } from 'commander';
import type { AuthenticatedContext } from '../../services/context.types';
import { includeSourceDescriptor } from '../../services/sources.service';
import type { CliCommandDependencies, SourceSyncCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import {
  createCompletedGitSourceSyncMessage,
  readTerminalSyncFailureMessage,
  waitForGitSourceSyncTask,
} from './source-sync.command.support';

export function registerSourceIncludeCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('include <sourceId> <descriptorPath>')).action(
    async (sourceId: string, descriptorPath: string, options: SourceSyncCommandOptions): Promise<void> => {
      const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
      const startedTask: GitSourceSyncTask = (await includeSourceDescriptor(context, sourceId, descriptorPath)).task;
      const completedTask: GitSourceSyncTask = await waitForGitSourceSyncTask(context, sourceId, startedTask);
      if (completedTask.status === 'failed' || completedTask.status === 'canceled') {
        throw new Error(readTerminalSyncFailureMessage(sourceId, completedTask));
      }

      dependencies.io.stdout(`${createCompletedGitSourceSyncMessage(sourceId, completedTask)}\n`);
    },
  );
}
