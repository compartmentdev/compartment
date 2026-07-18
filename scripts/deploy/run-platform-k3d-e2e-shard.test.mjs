import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildPlatformK3dShardEnvironment,
  isPlatformK3dSuite,
  readPlatformK3dShard,
  readPlatformK3dShardSuites,
  runWithPlatformK3dCleanup,
} from './run-platform-k3d-e2e-shard.mjs';

describe('platform k3d e2e shard runner', () => {
  it('defines isolated names, ports, namespaces, and state for every shard', () => {
    const environments = ['managed-install', 'user-flow', 'build-gates'].map((shard) =>
      buildPlatformK3dShardEnvironment(shard, {}),
    );

    expect(new Set(environments.map((env) => env.COMPARTMENT_E2E_CLUSTER_NAME))).toHaveLength(3);
    expect(new Set(environments.map((env) => env.COMPARTMENT_E2E_REGISTRY_NAME))).toHaveLength(3);
    expect(new Set(environments.map((env) => env.COMPARTMENT_E2E_REGISTRY_PORT))).toHaveLength(3);
    expect(new Set(environments.map((env) => env.COMPARTMENT_E2E_PLATFORM_NAMESPACE))).toHaveLength(3);
    expect(new Set(environments.map((env) => env.COMPARTMENT_E2E_PLATFORM_VALUES_PATH))).toHaveLength(3);
  });

  it('derives dependent settings from one cluster name and HTTP port', () => {
    const environment = buildPlatformK3dShardEnvironment('user-flow', {
      COMPARTMENT_E2E_API_URL: 'http://stale.invalid:1',
      COMPARTMENT_E2E_CLUSTER_NAME: 'custom-e2e',
      COMPARTMENT_E2E_DIAGNOSTICS_PATH: '..',
      COMPARTMENT_E2E_HTTP_PORT: '20000',
      COMPARTMENT_E2E_KUBE_CONTEXT: 'stale-context',
    });

    expect(environment).toMatchObject({
      COMPARTMENT_E2E_API_URL: 'http://console.compartment.localhost:20000',
      COMPARTMENT_E2E_CLUSTER_NAME: 'custom-e2e',
      COMPARTMENT_E2E_COMPARTMENT_URL: 'http://console.compartment.localhost:20000',
      COMPARTMENT_E2E_DIAGNOSTICS_PATH: '.compartment/platform-k3d-diagnostics-user-flow',
      COMPARTMENT_E2E_KUBE_CONTEXT: 'k3d-custom-e2e',
      COMPARTMENT_E2E_REGISTRY_NAME: 'custom-e2e-registry',
    });
  });

  it('rejects unknown or extra shard arguments', () => {
    expect(readPlatformK3dShard(['user-flow'])).toBe('user-flow');
    expect(() => readPlatformK3dShard([])).toThrow('Usage:');
    expect(() => readPlatformK3dShard(['unknown'])).toThrow('Usage:');
    expect(() => readPlatformK3dShard(['user-flow', 'extra'])).toThrow('Usage:');
  });

  it('assigns every existing e2e suite and gate to one explicit shard', () => {
    expect(readPlatformK3dShardSuites('managed-install')).toEqual(['managed-install', 'retained-state']);
    expect(readPlatformK3dShardSuites('user-flow')).toEqual(['install', 'system-user', 'console']);
    expect(readPlatformK3dShardSuites('build-gates')).toEqual(['install', 'build-matrix', 'g1', 'product-log']);
    expect(isPlatformK3dSuite('product-log')).toBe(true);
    expect(isPlatformK3dSuite('misspelled-suite')).toBe(false);
  });

  it('cleans successful and failed runs by default while preserving the original failure', async () => {
    const successCleanup = vi.fn(async () => undefined);
    await runWithPlatformK3dCleanup({
      cleanup: successCleanup,
      execute: async () => undefined,
      keepOnFailure: false,
      reportFailure: async () => undefined,
    });
    expect(successCleanup).toHaveBeenCalledOnce();

    const failureCleanup = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    await expect(
      runWithPlatformK3dCleanup({
        cleanup: failureCleanup,
        execute: async () => {
          throw new Error('suite failed');
        },
        keepOnFailure: false,
        reportFailure: async () => undefined,
      }),
    ).rejects.toThrow('suite failed');
    expect(failureCleanup).toHaveBeenCalledOnce();
  });

  it('keeps only failed runs when explicitly requested', async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(
      runWithPlatformK3dCleanup({
        cleanup,
        execute: async () => {
          throw new Error('suite failed');
        },
        keepOnFailure: true,
        reportFailure: async () => undefined,
      }),
    ).rejects.toThrow('suite failed');
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('cleans before preserving process signal termination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-k3d-signal-'));
    const markerPath = join(directory, 'cleaned');
    const moduleUrl = new URL('./run-platform-k3d-e2e-shard.mjs', import.meta.url).href;
    const program = `
import { writeFile } from 'node:fs/promises';
import { registerPlatformK3dSignalCleanup } from ${JSON.stringify(moduleUrl)};
registerPlatformK3dSignalCleanup(async () => await writeFile(${JSON.stringify(markerPath)}, 'cleaned'), false);
process.stdout.write('ready');
setInterval(() => undefined, 60_000);
`;
    try {
      const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise((resolveReady, rejectReady) => {
        child.once('error', rejectReady);
        child.stdout.once('data', resolveReady);
      });
      child.kill('SIGTERM');
      const signal = await new Promise((resolveClose) => {
        child.once('close', (_status, closeSignal) => resolveClose(closeSignal));
      });

      expect(signal).toBe('SIGTERM');
      await expect(readFile(markerPath, 'utf8')).resolves.toBe('cleaned');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
