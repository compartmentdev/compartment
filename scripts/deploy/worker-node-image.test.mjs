import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const bootstrapPath = resolve(repositoryRoot, 'scripts/deploy/prepare-worker-node-image.sh');
const compatibilityPath = resolve(repositoryRoot, 'packages/cli/src/services/kubernetes-install-compatibility.json');
const runtimeTestPath = resolve(repositoryRoot, 'scripts/deploy/worker-node-runtime-oom-e2e.sh');

describe('worker node image bootstrap', () => {
  it('uses the managed platform K3s and gVisor artifacts', async () => {
    const [bootstrap, compatibilitySource] = await Promise.all([
      readFile(bootstrapPath, 'utf8'),
      readFile(compatibilityPath, 'utf8'),
    ]);
    const compatibility = JSON.parse(compatibilitySource);

    for (const [artifactName, fields] of [
      ['k3s', ['sha256', 'url', 'version']],
      ['gvisor', ['sha256', 'sha512', 'url', 'version']],
    ]) {
      for (const field of fields) {
        expect(bootstrap).toContain(`.managed.${artifactName}.${field}`);
        expect(bootstrap).not.toContain(compatibility.managed[artifactName][field]);
      }
    }
    expect(bootstrap).toContain('.managed.containerdVersion');
  });

  it('cleans orphaned runsc shims without killing active workloads on agent restart', async () => {
    const bootstrap = await readFile(bootstrapPath, 'utf8');

    expect(bootstrap).toContain('KillMode=process');
    expect(bootstrap).toContain('ExecStartPost=-/usr/local/sbin/compartment-clean-orphan-runsc-shims');
    expect(bootstrap).toContain('EnvironmentFile=/etc/default/k3s-agent');
    expect(bootstrap).toContain('compartment-worker-join');
  });

  it('refuses an unmarked cluster and exercises both OOM deletion and CrashLoop restart paths', async () => {
    const runtimeTest = await readFile(runtimeTestPath, 'utf8');

    expect(runtimeTest).toContain('/etc/compartment-disposable-runtime-test');
    expect(runtimeTest).toContain('compartment\\.dev/disposable-runtime-test');
    expect(runtimeTest).toContain('restartPolicy: Always');
    expect(runtimeTest).not.toContain('restartPolicy: Never');
    expect(runtimeTest).toContain('systemctl restart k3s-agent.service');
    expect(runtimeTest).toContain('expected_containerd_version');
  });
});
