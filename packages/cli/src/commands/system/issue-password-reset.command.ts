import type { IssuePasswordResetResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { issueKubernetesPasswordReset } from '../../services/kubernetes-password-recovery.service';
import type { CliCommandDependencies } from '../command.types';
import { addKubernetesOperatorTargetOptions, resolveKubernetesOperatorTarget } from './system.command.options';
import { createIssuePasswordResetMessage } from './system.command.output';
import type { IssuePasswordResetCommandOptions } from './system.command.types';

export function registerIssuePasswordResetSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program
      .command('issue-password-reset')
      .description('Issue a private one-time password reset')
      .requiredOption('--email <email>', 'Owner email'),
  ).action(async (options: IssuePasswordResetCommandOptions): Promise<void> => {
    const result: IssuePasswordResetResponse = await issueKubernetesPasswordReset(
      resolveKubernetesOperatorTarget(options),
      options.email,
    );
    renderOutput(dependencies.io, options.output, result, createIssuePasswordResetMessage(result));
  });
}
