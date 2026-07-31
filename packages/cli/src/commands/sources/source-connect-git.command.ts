import type { Command } from 'commander';
import type { CliCommandDependencies, SourceConnectGitCommandOptions } from '../command.types';
import { addRemoteOption } from '../remote.command.helpers';
import { runSourceConnectGitCommand } from './source-connect-git-run.command';

export function registerSourceConnectGitCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('git')
      .option('--provider <provider>', 'git provider: github or gitlab')
      .option('--all', 'auto-adopt discovered descriptor apps')
      .option('--auto-adopt-new-apps <state>', 'enabled or disabled')
      .option('--auto-deploy', 'enable auto deploy for created bindings')
      .option('--branch <name>', 'branch to map on connect')
      .option('--env <name>', 'environment to map on connect')
      .option('--manual', 'create bindings without auto deploy'),
  ).action(async (options: SourceConnectGitCommandOptions): Promise<void> => {
    await runSourceConnectGitCommand(dependencies, options);
  });
}
