import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const wrapperPath = join(dirname(fileURLToPath(import.meta.url)), 'kubectl-e2e-bin/kubectl');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('kubectl E2E wrapper', () => {
  it('stubs only the ordinary-shard gVisor canary kernel probe', () => {
    const canary = runWrapper(
      ['--context', 'k3d-test', '--namespace', 'default', 'exec', 'pod/compartment-gvisor-id', '--', 'dmesg'],
      '0',
    );
    const normalCommand = runWrapper(['--context', 'k3d-test', 'get', 'pods'], '0');
    const realGvisorCanary = runWrapper(['exec', 'pod/compartment-gvisor-id', '--', 'dmesg'], '1');

    expect(canary).toContain('Starting gVisor test harness kernel');
    expect(normalCommand).toBe('real kubectl: --context k3d-test get pods');
    expect(realGvisorCanary).toBe('real kubectl: exec pod/compartment-gvisor-id -- dmesg');
  });
});

function runWrapper(args, gvisorEnabled) {
  const fakeBin = mkdtempSync(join(tmpdir(), 'compartment-kubectl-wrapper-'));
  temporaryDirectories.push(fakeBin);
  const fakeKubectl = join(fakeBin, 'kubectl');
  writeFileSync(fakeKubectl, '#!/bin/sh\nprintf "real kubectl: %s\\n" "$*"\n');
  chmodSync(fakeKubectl, 0o755);
  const result = spawnSync(wrapperPath, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      COMPARTMENT_E2E_GVISOR_ENABLED: gvisorEnabled,
      PATH: `${dirname(process.execPath)}${delimiter}${dirname(wrapperPath)}${delimiter}${fakeBin}`,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
