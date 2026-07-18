import { describe, expect, it, vi } from 'vitest';

import {
  buildPlatformK3dShardEnvironment,
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
});
