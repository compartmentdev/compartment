import { CommanderError } from 'commander';
import { runInheritedCommandWithPipedOutput } from '../../command-runner';
import type { CommandResult } from '../../command-runner.types';
import type { SelfHostedInstallResult } from '../../install.types';
import { rerunSelfHostedCommandWithSudoIfNeeded } from '../../self-hosted-sudo-rerun';
import type { CliCommandDependencies } from '../command.types';
import { parseSelfHostedInstallResultJson } from './install.command.helpers';

export async function rerunSelfHostedInstallCommandWithSudoIfNeeded(
  dependencies: CliCommandDependencies,
): Promise<SelfHostedInstallResult | undefined> {
  const sudoResult: CommandResult | undefined = await rerunSelfHostedCommandWithSudoIfNeeded({
    argv: dependencies.argv,
    buildArguments: buildInstallSudoArguments,
    commandPrefix: dependencies.commandPrefix,
    io: dependencies.io,
    messages: {
      interactivePrompt:
        'System self-hosted install requires root; re-running with sudo. You may be prompted for your password.',
      manualInstructions: 'System self-hosted install uses /etc/compartment and /var/lib/compartment.',
      passwordlessPrompt: 'System self-hosted install requires root; re-running with passwordless sudo.',
    },
    runCommand: runInheritedCommandWithPipedOutput,
  });
  if (sudoResult === undefined) {
    return undefined;
  }

  if (sudoResult.exitCode !== 0) {
    throw new CommanderError(sudoResult.exitCode, 'compartment.install.sudo_rerun', '');
  }

  return parseSelfHostedInstallResultJson(sudoResult.stdout);
}

function buildInstallSudoArguments(argv: readonly string[]): readonly string[] {
  return [...argv, '--skip-session-persist', '--internal-install-result', '--output', 'json'];
}
