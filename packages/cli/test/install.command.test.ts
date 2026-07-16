import { describe, expect, it } from 'vitest';
import { runCli } from '../src/app';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

describe('install command boundary', (): void => {
  it('requires operator values for production Kubernetes install', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--values is required for a Kubernetes install.');
  });

  it('keeps Kubernetes deployment options out of the dev install path', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(
      ['install', '--dev', '--api-url', 'https://console.apps.example.com'],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--dev cannot be combined with --api-url.');
  });

  it('rejects the removed local Docker runtime option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--local-runtime'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain("unknown option '--local-runtime'");
  });
});
