import { PassThrough } from 'node:stream';
import type { JsonValue } from '@compartment/utils';
import { expect, vi } from 'vitest';
import type { CliIo } from '../src/app.types';

export interface CliCommandCapture {
  io: CliIo;
  stderr: string[];
  stdin: PassThrough & {
    isTTY?: boolean | undefined;
  };
  stdout: string[];
}

export interface CliCommandResult {
  capture: CliCommandCapture;
  exitCode: number;
}

export interface CliJsonResult<TResult> extends CliCommandResult {
  payload: TResult;
}

interface CliJsonParser<TResult> {
  parse(input: JsonValue): TResult;
}

export function createCliCapture({
  isTTY = false,
  stderrIsTTY = isTTY,
  stdoutIsTTY = isTTY,
}: {
  isTTY?: boolean | undefined;
  stderrIsTTY?: boolean | undefined;
  stdoutIsTTY?: boolean | undefined;
} = {}): CliCommandCapture {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdin: PassThrough & {
    isTTY?: boolean | undefined;
  } = new PassThrough();
  stdin.isTTY = isTTY;

  return {
    io: {
      stderrIsTTY,
      stdin,
      stderr: (value: string): void => {
        stderr.push(value);
      },
      stdoutIsTTY,
      stdout: (value: string): void => {
        stdout.push(value);
      },
    },
    stderr,
    stdin,
    stdout,
  };
}

export async function runCliCommand(
  argv: string[],
  capture: CliCommandCapture = createCliCapture(),
): Promise<CliCommandResult> {
  const { runCli } = await import('../src/app');
  const exitCode: number = await runCli(argv, capture.io);

  return {
    capture,
    exitCode,
  };
}

export async function runCliJson<TResult>(
  argv: string[],
  parser: CliJsonParser<TResult>,
  capture: CliCommandCapture = createCliCapture(),
): Promise<CliJsonResult<TResult>> {
  const result: CliCommandResult = await runCliCommand(argv, capture);
  const payload: JsonValue = JSON.parse(readCliStdout(result.capture)) as JsonValue;

  return {
    ...result,
    payload: parser.parse(payload),
  };
}

export function expectCliSuccess(result: CliCommandResult): void {
  expect(result.exitCode).toBe(0);
}

export function expectCliFailure(result: CliCommandResult, expectedMessage: string): void {
  expect(result.exitCode).toBe(1);
  expect(readCliStderr(result.capture)).toContain(expectedMessage);
}

export function readCliStdout(capture: CliCommandCapture): string {
  return capture.stdout.join('');
}

export function readCliStderr(capture: CliCommandCapture): string {
  return capture.stderr.join('');
}

export function resetCliCommandModules(): void {
  vi.resetModules();
}

export function restoreCliCommandModules(modulePaths: readonly string[]): void {
  for (const modulePath of modulePaths) {
    vi.doUnmock(modulePath);
  }
}
