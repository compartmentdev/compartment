import type { CommandProgress, CommandProgressInput } from '../command.progress.types';
import type { InstallCommandOptions } from './install.command.types';

export interface InstallCommandProgressInput extends Omit<CommandProgressInput, 'enabled' | 'output'> {
  options: InstallCommandOptions;
}

export type InstallCommandProgress = CommandProgress;
