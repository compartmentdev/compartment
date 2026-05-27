import { describe, expect, it } from 'vitest';
import { createCommandProgress } from '../src/commands/command.progress';
import type { CommandProgress } from '../src/commands/command.progress.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

describe('command progress', (): void => {
  it('renders and clears a TTY status line for text output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Starting self-hosted runtime...');
    progress.stop();
    const stoppedOutput: string = readCliStderr(capture);

    expect(stoppedOutput).toBe('\r\u001B[2KStarting self-hosted runtime...\r\u001B[2K');
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

  it('does not render timer frames for unchanged TTY progress', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Deploy smoke-web/production: web=queued (building), elapsed 1.2s.');
    progress.stop();

    expect(readCliStderr(capture)).toBe(
      '\r\u001B[2KDeploy smoke-web/production: web=queued (building), elapsed 1.2s.\r\u001B[2K',
    );
  });

  it('renders multiline TTY progress once as lines', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: CommandProgress = createCommandProgress({
      io: capture.io,
      output: 'text',
    });

    progress.report('Starting self-hosted runtime...');
    progress.report('Runtime warning:\nfailed to verify one image');
    progress.stop();

    const output: string = readCliStderr(capture);
    expect(output).toContain('\r\u001B[2KStarting self-hosted runtime...');
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
