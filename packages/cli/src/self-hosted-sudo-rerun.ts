import { quoteShellArgument, quoteShellArgumentWhenNeeded } from '@compartment/utils';
import { canRunCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import type { SelfHostedSudoCommandInput, SelfHostedSudoRerunCommandInput } from './self-hosted-sudo-rerun.types';

interface TtyReadable {
  isTTY?: boolean | undefined;
}

export async function rerunSelfHostedCommandWithSudoIfNeeded(
  input: SelfHostedSudoRerunCommandInput,
): Promise<CommandResult | undefined> {
  if (process.getuid?.() === 0) {
    return undefined;
  }

  const sudoCommand: readonly string[] = await resolveSelfHostedSudoCommand(input);
  return await input.runCommand(sudoCommand);
}

export async function resolveSelfHostedSudoCommand(input: SelfHostedSudoCommandInput): Promise<readonly string[]> {
  if (await canRunCommand(['sudo', '-n', 'true'])) {
    input.io.stderr(`${input.messages.passwordlessPrompt}\n`);
    return ['sudo', '-n', ...input.commandPrefix, ...input.buildArguments(input.argv)];
  }

  if (canUseInteractiveSudo(input)) {
    input.io.stderr(`${input.messages.interactivePrompt}\n`);
    return ['sudo', ...input.commandPrefix, ...input.buildArguments(input.argv)];
  }

  throw new Error(
    `${input.messages.manualInstructions} Run \`${formatManualSelfHostedCommand(input)}\` from an interactive shell.`,
  );
}

function canUseInteractiveSudo(input: SelfHostedSudoCommandInput): boolean {
  const stdin: TtyReadable = input.io.stdin as TtyReadable;
  return stdin.isTTY === true;
}

function formatManualSelfHostedCommand(input: SelfHostedSudoCommandInput): string {
  const manualPrefix: readonly string[] = input.manualPrefix ?? [];
  return [
    ...manualPrefix.map(quoteShellArgumentWhenNeeded),
    ...input.commandPrefix.map(quoteShellArgument),
    ...input.argv.map(quoteShellArgumentWhenNeeded),
  ].join(' ');
}
