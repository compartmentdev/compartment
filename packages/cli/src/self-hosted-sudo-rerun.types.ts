import type { CliIo } from './app.types';
import type { CommandResult } from './command-runner.types';

export interface SelfHostedSudoMessages {
  interactivePrompt: string;
  manualInstructions: string;
  passwordlessPrompt: string;
}

export interface SelfHostedSudoInput {
  argv: readonly string[];
  commandPrefix: readonly string[];
  io: CliIo;
}

export interface SelfHostedSudoCommandInput extends SelfHostedSudoInput {
  buildArguments: (argv: readonly string[]) => readonly string[];
  manualPrefix?: readonly string[] | undefined;
  messages: SelfHostedSudoMessages;
}

export interface SelfHostedSudoRerunCommandInput extends SelfHostedSudoCommandInput {
  runCommand: (command: readonly string[]) => Promise<CommandResult>;
}
