import { CommanderError } from 'commander';
import { runInheritedCommand } from '../../command-runner';
import type { CommandResult } from '../../command-runner.types';
import { SelfHostedSystemPrivilegesError } from '../../self-hosted-system-privileges';
import { resolveSelfHostedSudoCommand } from '../../self-hosted-sudo-rerun';
import type { CliCommandDependencies } from '../command.types';

export async function executeSelfHostedSystemCommandWithSudoFallback(
  dependencies: CliCommandDependencies,
  command: () => Promise<void>,
): Promise<void> {
  try {
    await command();
  } catch (error) {
    if (!(error instanceof SelfHostedSystemPrivilegesError)) {
      throw error;
    }

    await rerunSelfHostedSystemCommandWithSudo(dependencies);
  }
}

async function rerunSelfHostedSystemCommandWithSudo(dependencies: CliCommandDependencies): Promise<void> {
  const sudoCommand: readonly string[] = await resolveSelfHostedSudoCommand({
    argv: dependencies.argv,
    buildArguments: readSystemSudoArguments,
    commandPrefix: dependencies.commandPrefix,
    io: dependencies.io,
    manualPrefix: ['sudo'],
    messages: {
      interactivePrompt:
        'System self-hosted command requires root; re-running with sudo. You may be prompted for your password.',
      manualInstructions: 'System self-hosted commands use /etc/compartment and /var/lib/compartment.',
      passwordlessPrompt: 'System self-hosted command requires root; re-running with passwordless sudo.',
    },
  });
  const result: CommandResult = await runInheritedCommand(sudoCommand);
  if (result.exitCode !== 0) {
    throw new CommanderError(result.exitCode, 'compartment.system.sudo_rerun', '');
  }
}

function readSystemSudoArguments(argv: readonly string[]): readonly string[] {
  return argv;
}
