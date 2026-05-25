import type { CliRemoteRemoveResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { createRemoteRemoveMessage, removeRemote } from '../../services/remotes.service';
import type { RemoveRemoteResult } from '../../services/remotes.service.types';
import { assertValidRemoteName } from '../../services/remote-name.service';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';

export function registerRemoveRemoteCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('remove <name>')
    .option('--output <format>', 'text or json', 'text')
    .action(async (remoteName: string, options: OutputOnlyOptions): Promise<void> => {
      assertValidRemoteName(remoteName);
      const config: CliConfig = await readCliConfig();
      const result: RemoveRemoteResult = removeRemote(config, remoteName);
      await writeCliConfig(result.config);

      renderOutput(
        dependencies.io,
        options.output,
        result.response satisfies CliRemoteRemoveResponse,
        createRemoteRemoveMessage(result.response),
      );
    });
}
