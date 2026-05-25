import type { CliRemoteResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { createRemoteUseMessage, useRemote } from '../../services/remotes.service';
import type { UseRemoteResult } from '../../services/remotes.service.types';
import { assertValidRemoteName } from '../../services/remote-name.service';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';

export function registerUseRemoteCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('use <name>')
    .option('--output <format>', 'text or json', 'text')
    .action(async (remoteName: string, options: OutputOnlyOptions): Promise<void> => {
      assertValidRemoteName(remoteName);
      const config: CliConfig = await readCliConfig();
      const result: UseRemoteResult = await useRemote(config, process.cwd(), remoteName);
      await writeCliConfig(result.config);

      renderOutput(
        dependencies.io,
        options.output,
        result.response satisfies CliRemoteResponse,
        createRemoteUseMessage(result.response, result.stateFilePath, result.wroteProjectState),
      );
    });
}
