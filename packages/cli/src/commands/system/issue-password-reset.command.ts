import type { IssuePasswordResetResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { issueSelfHostedPasswordReset } from '../../system-password-reset';
import type { CliCommandDependencies } from '../command.types';
import { createIssuePasswordResetResultMessage } from './system.command.helpers';
import { executeSelfHostedSystemCommandWithSudoFallback } from './system.command.sudo';
import type { IssuePasswordResetCommandOptions } from './system.command.types';

export function registerIssuePasswordResetSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('issue-password-reset')
    .requiredOption('--email <email>', 'user email')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: IssuePasswordResetCommandOptions): Promise<void> =>
        await executeIssuePasswordResetCommand(dependencies, options),
    );
}

async function executeIssuePasswordResetCommand(
  dependencies: CliCommandDependencies,
  options: IssuePasswordResetCommandOptions,
): Promise<void> {
  await executeSelfHostedSystemCommandWithSudoFallback(dependencies, async (): Promise<void> => {
    const result: IssuePasswordResetResponse = await issueSelfHostedPasswordReset(options.email);

    renderOutput(dependencies.io, options.output, result, createIssuePasswordResetResultMessage(result));
  });
}
