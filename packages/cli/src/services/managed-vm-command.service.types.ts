export interface ManagedVmCommandOptions {
  input?: string | undefined;
  reject?: boolean | undefined;
  stdio?: 'inherit' | undefined;
}

export interface ManagedVmCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}
