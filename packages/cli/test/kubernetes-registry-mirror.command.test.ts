import { describe, expect, it } from 'vitest';
import { runCli } from '../src/app';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

describe('Kubernetes registry mirror command boundary', (): void => {
  it('rejects a non-Service registry host before changing the node', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const clusterIp: string = ['10', '43', '210', '17'].join('.');
    const exitCode: number = await runCli(
      ['system', 'registry-mirror', 'apply', '--registry-host', 'registry.example.com:5000', '--cluster-ip', clusterIp],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain(
      'Registry mirror host must be a canonical Kubernetes Service DNS name on port 5000.',
    );
  });
});
