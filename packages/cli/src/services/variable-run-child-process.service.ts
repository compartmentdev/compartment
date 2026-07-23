import type { ChildProcess } from 'node:child_process';
import type { execa as Execa, Result, ResultPromise } from 'execa';
import type { CommandResult } from '../command-runner.types';

interface VariableChildOptions {
  env: NodeJS.ProcessEnv;
  extendEnv: false;
  reject: false;
  stdio: 'inherit';
}

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
  const options: VariableChildOptions = {
    env,
    extendEnv: false,
    reject: false,
    stdio: 'inherit',
  };
  const subprocess: ResultPromise<VariableChildOptions> = (await loadExeca())(file, args, options);
  const signalHandlers: VariableChildSignalHandler[] = registerVariableChildSignalHandlers(subprocess);
  const result: Result<VariableChildOptions> = await subprocess.finally((): void => {
    cleanupVariableChildSignalHandlers(signalHandlers);
  });
  return readVariableChildResult(result);
}

function readVariableChildResult(result: Result<VariableChildOptions>): CommandResult {
  return {
    exitCode: readVariableChildExitCode(result.exitCode ?? null, result.signal ?? null, result.code),
    stderr: result.exitCode === undefined && result.signal === undefined ? (result.originalMessage ?? '') : '',
    stdout: '',
  };
}

async function loadExeca(): Promise<typeof Execa> {
  return (await import(/* webpackMode: "eager" */ 'execa')).execa;
}

function registerVariableChildSignalHandlers(child: Pick<ChildProcess, 'kill'>): VariableChildSignalHandler[] {
  return forwardedSignals.map((signal: NodeJS.Signals): VariableChildSignalHandler => {
    const handler: () => void = (): void => {
      child.kill(signal);
    };
    process.once(signal, handler);
    return new VariableChildSignalHandler(signal, handler);
  });
}

function readVariableChildExitCode(code: number | null, signal: NodeJS.Signals | null, errorCode?: string): number {
  if (code !== null) {
    return code;
  }
  if (errorCode !== undefined) {
    return 127;
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
