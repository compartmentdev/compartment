import { spawn, type ChildProcess } from 'node:child_process';
import type { ManagedVmCommandOptions, ManagedVmCommandResult } from './managed-vm-command.service.types';

export type { ManagedVmCommandResult } from './managed-vm-command.service.types';

export async function execa(
  command: string,
  args: readonly string[],
  options: ManagedVmCommandOptions = {},
): Promise<ManagedVmCommandResult> {
  return await new Promise((resolve: (result: ManagedVmCommandResult) => void, reject: (error: Error) => void): void =>
    runCommand(command, args, options, resolve, reject),
  );
}

function runCommand(
  command: string,
  args: readonly string[],
  options: ManagedVmCommandOptions,
  resolve: (result: ManagedVmCommandResult) => void,
  reject: (error: Error) => void,
): void {
  const child: ChildProcess = spawn(command, args, { stdio: options.stdio === 'inherit' ? 'inherit' : 'pipe' });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer): number => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer): number => stderr.push(chunk));
  child.once('error', reject);
  child.once('close', (code: number | null): void => {
    const result: ManagedVmCommandResult = buildResult(code, stdout, stderr);
    if (result.exitCode !== 0 && options.reject !== false) {
      reject(new Error(`${command} failed (${String(result.exitCode)}): ${result.stderr.trim()}`));
      return;
    }
    resolve(result);
  });
  if (options.stdio !== 'inherit') {
    child.stdin?.end(options.input);
  }
}

function buildResult(
  code: number | null,
  stdout: readonly Buffer[],
  stderr: readonly Buffer[],
): ManagedVmCommandResult {
  return {
    exitCode: code ?? 1,
    stderr: Buffer.concat(stderr).toString('utf8'),
    stdout: Buffer.concat(stdout).toString('utf8'),
  };
}
