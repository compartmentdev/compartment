import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { CommandResult } from '../command-runner.types';

const forwardedSignals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const forwardedSignalExitCodes: ReadonlyMap<NodeJS.Signals, number> = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
]);

export async function runVariableChildCommand(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  return await new Promise<CommandResult>((resolve: (result: CommandResult) => void): void => {
    const child: ChildProcess = spawn(file, args, readVariableChildSpawnOptions(env));
    const signalHandlers: VariableChildSignalHandler[] = registerVariableChildSignalHandlers(child);
    registerVariableChildCompletionHandlers(child, signalHandlers, resolve);
  });
}

function readVariableChildSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    env,
    stdio: 'inherit',
  };
}

function registerVariableChildSignalHandlers(child: ChildProcess): VariableChildSignalHandler[] {
  return forwardedSignals.map((signal: NodeJS.Signals): VariableChildSignalHandler => {
    const handler: () => void = (): void => {
      child.kill(signal);
    };
    process.once(signal, handler);
    return new VariableChildSignalHandler(signal, handler);
  });
}

function registerVariableChildCompletionHandlers(
  child: ChildProcess,
  signalHandlers: readonly VariableChildSignalHandler[],
  resolve: (result: CommandResult) => void,
): void {
  child.on('error', (error: Error): void => {
    cleanupVariableChildSignalHandlers(signalHandlers);
    resolve({
      exitCode: 127,
      stderr: error.message,
      stdout: '',
    });
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null): void => {
    cleanupVariableChildSignalHandlers(signalHandlers);
    resolve({
      exitCode: readVariableChildExitCode(code, signal),
      stderr: '',
      stdout: '',
    });
  });
}

function readVariableChildExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  if (signal !== null) {
    return forwardedSignalExitCodes.get(signal) ?? 1;
  }
  return 1;
}

function cleanupVariableChildSignalHandlers(signalHandlers: readonly VariableChildSignalHandler[]): void {
  signalHandlers.forEach((registration: VariableChildSignalHandler): void => {
    process.off(registration.signal, registration.handler);
  });
}

class VariableChildSignalHandler {
  constructor(
    readonly signal: NodeJS.Signals,
    readonly handler: () => void,
  ) {}
}
