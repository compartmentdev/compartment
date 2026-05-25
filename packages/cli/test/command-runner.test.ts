import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runCappedCommand, runInheritedCommandWithPipedOutput } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import type * as ChildProcessModule from 'node:child_process';

type Spawn = typeof ChildProcessModule.spawn;

interface CommandRunnerTestMocks {
  spawn: Mock<Spawn>;
}

const mocks: CommandRunnerTestMocks = vi.hoisted(
  (): CommandRunnerTestMocks => ({
    spawn: vi.fn<Spawn>(),
  }),
);

vi.mock('node:child_process', async (): Promise<object> => {
  const actual: typeof ChildProcessModule = await vi.importActual('node:child_process');
  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

describe('runCappedCommand', (): void => {
  afterEach((): void => {
    mocks.spawn.mockReset();
  });

  it('keeps stdin attached while capturing stdout and stderr', async (): Promise<void> => {
    let receivedOptions: SpawnOptions | undefined;
    mocks.spawn.mockImplementation((_file: string, _args?: readonly string[], options?: SpawnOptions): ChildProcess => {
      receivedOptions = options;
      const child: ChildProcess = createChildProcess();
      queueMicrotask((): void => {
        child.stdout?.emit('data', 'captured stdout\n');
        child.stderr?.emit('data', 'captured stderr\n');
        child.emit('close', 0);
      });
      return child;
    });

    const result: CommandResult = await runCappedCommand(['docker', 'info']);

    expect(receivedOptions?.stdio).toEqual(['inherit', 'pipe', 'pipe']);
    expect(result).toEqual({
      exitCode: 0,
      stderr: 'captured stderr',
      stdout: 'captured stdout',
    });
  });
});

describe('runInheritedCommandWithPipedOutput', (): void => {
  afterEach((): void => {
    mocks.spawn.mockReset();
  });

  it('keeps stdin and stderr attached while capturing stdout', async (): Promise<void> => {
    let receivedOptions: SpawnOptions | undefined;
    mocks.spawn.mockImplementation((_file: string, _args?: readonly string[], options?: SpawnOptions): ChildProcess => {
      receivedOptions = options;
      const child: ChildProcess = createChildProcess();
      queueMicrotask((): void => {
        child.stdout?.emit('data', '{"ok":true}\n');
        child.emit('close', 0);
      });
      return child;
    });

    const result: CommandResult = await runInheritedCommandWithPipedOutput(['sudo', 'compartment', 'install']);

    expect(receivedOptions?.stdio).toEqual(['inherit', 'pipe', 'inherit']);
    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: '{"ok":true}',
    });
  });
});

function createChildProcess(): ChildProcess {
  const child: ChildProcess = new EventEmitter() as ChildProcess;
  child.stderr = createOutputStream();
  child.stdout = createOutputStream();
  return child;
}

function createOutputStream(): PassThrough {
  const stream: PassThrough = new PassThrough();
  stream.setEncoding('utf8');
  return stream;
}
