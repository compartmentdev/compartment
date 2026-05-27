import { describe, expect, it, vi } from 'vitest';
import { createCommandProgress } from '../src/commands/command.progress';
import type { CommandProgress } from '../src/commands/command.progress.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

describe('command progress', (): void => {
  it('renders and clears a spinner for text TTY output', (): void => {
    vi.useFakeTimers();
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Starting self-hosted runtime...');
    vi.advanceTimersByTime(120);
    progress.stop();
    const stoppedOutput: string = readCliStderr(capture);
    vi.advanceTimersByTime(30);
    vi.useRealTimers();

    expect(stoppedOutput).toContain('- Starting self-hosted runtime...');
    expect(stoppedOutput).toContain('\\ Starting self-hosted runtime...');
    expect(stoppedOutput.endsWith('\r\u001B[2K')).toBe(true);
    expect(readCliStderr(capture)).toBe(stoppedOutput);
  });

  it('renders line progress for redirected text output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Preparing source archive...');
    progress.stop();

    expect(readCliStderr(capture)).toBe('Preparing source archive...\n');
  });

  it('truncates TTY spinner frames before the terminal wraps them', (): void => {
    vi.useFakeTimers();
    const capture: CliCommandCapture = createCliCapture({ stderrColumns: 20, stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Starting self-hosted runtime...');
    vi.advanceTimersByTime(120);
    progress.stop();
    vi.useRealTimers();

    const frames: string[] = readCliStderr(capture)
      .split('\r\u001B[2K')
      .filter((frame: string): boolean => frame !== '');
    expect(frames).toEqual(['- Starting self-...', '\\ Starting self-...']);
    expect(frames.every((frame: string): boolean => frame.length < 20)).toBe(true);
  });

  it('renders multiline TTY progress once as lines', (): void => {
    vi.useFakeTimers();
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Starting self-hosted runtime...');
    progress.report('Runtime warning:\nfailed to verify one image');
    vi.advanceTimersByTime(240);
    progress.stop();
    vi.useRealTimers();

    const output: string = readCliStderr(capture);
    expect(output).toContain('- Starting self-hosted runtime...');
    expect(output).toContain('\r\u001B[2KRuntime warning:\nfailed to verify one image\n');
    expect(output).not.toContain('| Runtime warning:');
    expect(output).not.toContain('/ Runtime warning:');
  });

  it('does not render progress for json output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'json',
    });

    progress.report('Preparing source archive...');
    progress.stop();

    expect(readCliStderr(capture)).toBe('');
  });
});
