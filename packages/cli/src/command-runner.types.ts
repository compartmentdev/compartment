export interface CommandNotFoundFailure {
  command: string;
  kind: 'command-not-found';
}

export type CommandExecutionFailure = CommandNotFoundFailure;

export interface CommandResult {
  exitCode: number;
  failure?: CommandExecutionFailure | undefined;
  stderr: string;
  stdout: string;
}
