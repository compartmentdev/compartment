import { describe, expect, it } from 'vitest';
import { runCli } from '../src/app';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

describe('install command cutover boundary', (): void => {
  it('rejects the removed local Docker runtime option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--local-runtime'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain("unknown option '--local-runtime'");
  });
});
