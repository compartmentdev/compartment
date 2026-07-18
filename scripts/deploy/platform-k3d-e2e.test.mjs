import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isConsoleReadyStatus,
  parseDockerImageCommand,
  parseK3dClusterNames,
  parseLoadedImageRefs,
  readPlatformK3dCommand,
  readPlatformK3dEnvironment,
  renderK3dRegistryConfig,
  renderManagedPlatformK3dValues,
  renderPlatformK3dValues,
} from './platform-k3d-e2e.mjs';
import {
  buildDockerContainerRemovalArgs,
  isPlatformSourceCacheImageRef,
  isRunOwnedDockerResourceName,
  isRunOwnedImageRef,
  readPlatformK3dCleanupStageNames,
  runPlatformK3dCleanupSequence,
  settlePlatformK3dStartup,
  shouldCleanPlatformSourceCacheImage,
  shouldCleanLegacyPlatformResources,
  withPlatformK3dProcessLock,
} from './platform-k3d-e2e-support.mjs';

describe('platform k3d e2e command boundary', () => {
  it('removes container-owned anonymous volumes during cleanup', () => {
    expect(buildDockerContainerRemovalArgs('managed-caddy-build')).toEqual([
      'container',
      'rm',
      '--force',
      '--volumes',
      'managed-caddy-build',
    ]);
  });

  it('preserves validated source image runtime commands for managed Caddy commits', () => {
    expect(parseDockerImageCommand('["/usr/bin/entrypoint"]', 'entrypoint')).toEqual(['/usr/bin/entrypoint']);
    expect(parseDockerImageCommand('["caddy","run"]', 'command')).toEqual(['caddy', 'run']);
    expect(() => parseDockerImageCommand('null', 'entrypoint')).toThrow(
      'Expected entrypoint to be a non-empty JSON command array.',
    );
    expect(() => parseDockerImageCommand('{', 'command')).toThrow('Expected command to be a JSON command array.');
  });

  it('accepts the up action with built images by default', () => {
    expect(readPlatformK3dCommand(['up'])).toEqual({
      action: 'up',
      imageArchiveDir: undefined,
      imageSource: 'build',
    });
  });

  it('accepts the up action with an image archive directory', () => {
    expect(readPlatformK3dCommand(['up', '--image-source', 'archive', '--image-archive-dir', './image-cache'])).toEqual(
      {
        action: 'up',
        imageArchiveDir: './image-cache',
        imageSource: 'archive',
      },
    );
  });

  it('accepts the down action without options', () => {
    expect(readPlatformK3dCommand(['down'])).toEqual({ action: 'down' });
    expect(readPlatformK3dCommand(['configure'])).toEqual({ action: 'configure' });
  });

  it('rejects unknown actions and malformed options', () => {
    expect(() => readPlatformK3dCommand([])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['restart'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['down', 'extra'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['configure', 'extra'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['up', '--image-source'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['up', '--image-source', 'registry'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['up', '--image-source', 'archive'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['up', '--image-archive-dir', './image-cache'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['up', '--unknown', 'value'])).toThrow('Usage:');
  });

  it('finds exact cluster names in k3d output', () => {
    expect(parseK3dClusterNames('compartment-e2e  1/1\nother-cluster  1/1\n')).toEqual([
      'compartment-e2e',
      'other-cluster',
    ]);
  });

  it('validates an isolated shard environment', () => {
    const environment = readPlatformK3dEnvironment({
      COMPARTMENT_E2E_CLUSTER_NAME: 'compartment-e2e-user-flow',
      COMPARTMENT_E2E_HTTP_PORT: '18180',
      COMPARTMENT_E2E_PLATFORM_NAMESPACE: 'compartment-user-flow',
      COMPARTMENT_E2E_REGISTRY_NAME: 'compartment-e2e-user-flow-registry',
      COMPARTMENT_E2E_REGISTRY_PORT: '15600',
    });

    expect(environment).toMatchObject({
      clusterName: 'compartment-e2e-user-flow',
      httpPort: 18_180,
      platformNamespace: 'compartment-user-flow',
      registryHostPort: 15_600,
      registryName: 'compartment-e2e-user-flow-registry',
    });
    expect(() => readPlatformK3dEnvironment({ COMPARTMENT_E2E_HTTP_PORT: '0' })).toThrow(
      'COMPARTMENT_E2E_HTTP_PORT must be an integer between 1024 and 65535.',
    );
    expect(() => readPlatformK3dEnvironment({ COMPARTMENT_E2E_KEEP_ON_FAILURE: 'yes' })).toThrow(
      'COMPARTMENT_E2E_KEEP_ON_FAILURE must be 0 or 1.',
    );
    expect(() =>
      readPlatformK3dEnvironment({ COMPARTMENT_E2E_PLATFORM_VALUES_PATH: '../outside-values.yaml' }),
    ).toThrow('must resolve inside');
  });

  it('targets only resources owned by the selected shard', () => {
    const environment = readPlatformK3dEnvironment({
      COMPARTMENT_E2E_CLUSTER_NAME: 'compartment-e2e-build-gates',
      COMPARTMENT_E2E_REGISTRY_NAME: 'compartment-e2e-build-gates-registry',
      COMPARTMENT_E2E_REGISTRY_PORT: '15700',
    });

    expect(isRunOwnedDockerResourceName('k3d-compartment-e2e-build-gates', environment)).toBe(true);
    expect(isRunOwnedDockerResourceName('k3d-compartment-e2e-build-gates-serverlb', environment)).toBe(true);
    expect(isRunOwnedDockerResourceName('compartment-e2e-build-gates-pebble-ca', environment)).toBe(true);
    expect(isRunOwnedDockerResourceName('compartment-e2e-build-gates-managed-caddy-build', environment)).toBe(true);
    expect(isRunOwnedDockerResourceName('k3d-compartment-e2e-user-flow', environment)).toBe(false);
    expect(isRunOwnedImageRef('localhost:15700/compartment-api:e2e', environment)).toBe(true);
    expect(isRunOwnedImageRef('ghcr.io/compartmentdev/compartment-api:sha-abc123', environment)).toBe(false);
    expect(
      isRunOwnedImageRef('ghcr.io/compartmentdev/compartment-api:e2e-compartment-e2e-build-gates', environment),
    ).toBe(true);
    expect(isRunOwnedImageRef('localhost:15600/compartment-api:e2e', environment)).toBe(false);
    expect(isRunOwnedImageRef('postgres:16', environment)).toBe(false);
    const cacheImageRef = `ghcr.io/compartmentdev/compartment-api:sha-${'a'.repeat(40)}`;
    expect(isPlatformSourceCacheImageRef(cacheImageRef)).toBe(true);
    expect(isPlatformSourceCacheImageRef('ghcr.io/compartmentdev/compartment-api:sha-local')).toBe(false);
    expect(isPlatformSourceCacheImageRef('postgres:16')).toBe(false);
    expect(shouldCleanPlatformSourceCacheImage(cacheImageRef, '2026-07-16T00:00:00.000Z', Date.UTC(2026, 6, 18))).toBe(
      true,
    );
    expect(shouldCleanPlatformSourceCacheImage(cacheImageRef, '2026-07-18T00:00:00.000Z', Date.UTC(2026, 6, 18))).toBe(
      false,
    );
    expect(shouldCleanLegacyPlatformResources(environment)).toBe(true);
    expect(shouldCleanLegacyPlatformResources(readPlatformK3dEnvironment({}))).toBe(false);
  });

  it('keeps every cleanup stage and continues after an individual failure', () => {
    expect(readPlatformK3dCleanupStageNames()).toEqual([
      'cluster',
      'registry',
      'builder',
      'residual Docker resources',
      'run-owned images',
      'state files and directories',
    ]);
    const attempted = [];
    const errors = runPlatformK3dCleanupSequence(
      readPlatformK3dCleanupStageNames().map((label) => ({
        cleanup: () => {
          attempted.push(label);
          if (label === 'cluster') {
            throw new Error('cluster cleanup failed');
          }
        },
        label,
      })),
      'compartment-e2e-test',
    );
    expect(attempted).toEqual(readPlatformK3dCleanupStageNames());
    expect(errors).toHaveLength(1);
  });

  it('serializes process locks, recovers stale owners, and releases after failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-k3d-lock-test-'));
    const lockDirectory = join(directory, 'lock');
    let releaseFirst;
    let secondStarted = false;
    try {
      const first = withPlatformK3dProcessLock(
        lockDirectory,
        async () =>
          await new Promise((resolveFirst) => {
            releaseFirst = resolveFirst;
          }),
      );
      await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 25));
      const second = withPlatformK3dProcessLock(lockDirectory, async () => {
        secondStarted = true;
      });
      await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 125));
      expect(secondStarted).toBe(false);
      releaseFirst();
      await Promise.all([first, second]);
      expect(secondStarted).toBe(true);

      await expect(
        withPlatformK3dProcessLock(lockDirectory, async () => {
          throw new Error('operation failed');
        }),
      ).rejects.toThrow('operation failed');
      await expect(withPlatformK3dProcessLock(lockDirectory, async () => 'reacquired')).resolves.toBe('reacquired');

      mkdirSync(lockDirectory);
      writeFileSync(join(lockDirectory, 'pid'), 'invalid');
      await expect(withPlatformK3dProcessLock(lockDirectory, async () => 'stale-recovered')).resolves.toBe(
        'stale-recovered',
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('reads loaded image refs from docker load output', () => {
    expect(
      parseLoadedImageRefs(
        'Loaded image: ghcr.io/compartmentdev/compartment-api:sha-abc123\nLoaded image: ghcr.io/compartmentdev/compartment-worker:sha-abc123\n',
      ),
    ).toEqual([
      'ghcr.io/compartmentdev/compartment-api:sha-abc123',
      'ghcr.io/compartmentdev/compartment-worker:sha-abc123',
    ]);
    expect(parseLoadedImageRefs('unrelated output\n')).toEqual([]);
  });

  it('waits for both startup branches before preserving the first failure', async () => {
    let finishImages;
    const images = new Promise((resolveImages) => {
      finishImages = resolveImages;
    });
    let settled = false;
    const startup = settlePlatformK3dStartup(Promise.reject(new Error('cluster failed')), images).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    finishImages({ imageDigestsByServiceName: {} });
    await expect(startup).rejects.toThrow('cluster failed');
  });

  it('accepts only the console redirect as ready', () => {
    expect(isConsoleReadyStatus(302)).toBe(true);
    expect(isConsoleReadyStatus(200)).toBe(false);
    expect(isConsoleReadyStatus(503)).toBe(false);
  });

  it('maps the bundled registry authority to its node-reachable Service IP', () => {
    const config = renderK3dRegistryConfig('compartment-compartment-registry-auth.compartment.svc:5000', '10.43.12.34');

    expect(config).toBe(`mirrors:
  "compartment-compartment-registry-auth.compartment.svc:5000":
    endpoint:
      - "http://10.43.12.34:5000"
`);
    expect(config).not.toContain('cluster.local');
  });

  it('writes the operator values consumed by the production install command', () => {
    const values = renderPlatformK3dValues({
      api: `sha256:${'a'.repeat(64)}`,
      caddy: `sha256:${'d'.repeat(64)}`,
      edge: `sha256:${'c'.repeat(64)}`,
      worker: `sha256:${'b'.repeat(64)}`,
    });

    expect(values).toContain('baseDomain: compartment.localhost');
    expect(values).toContain('publicProtocol: http');
    expect(values).toContain('type: NodePort');
    expect(values).toContain('httpPort: 80');
    expect(values).toContain('httpsPort: 443');
    expect(values).toContain('httpNodePort: 30080');
    expect(values).toContain('httpsNodePort: 30443');
    expect(values).toContain('namespace: compartment-build');
    expect(values).toContain('repository: k3d-compartment-e2e-registry:15500/compartment-api');
    expect(values).toContain(`digest: sha256:${'a'.repeat(64)}`);
    expect(values).not.toContain('ports:\n  http: 18080');
    expect(values).not.toContain('startupStage:');
  });

  it('writes isolated managed-install values with the ACME fixture and verified digests', () => {
    const values = renderManagedPlatformK3dValues(
      {
        api: `sha256:${'a'.repeat(64)}`,
        caddy: `sha256:${'d'.repeat(64)}`,
        edge: `sha256:${'c'.repeat(64)}`,
        worker: `sha256:${'b'.repeat(64)}`,
      },
      `sha256:${'e'.repeat(64)}`,
    );

    expect(values).toContain('acmeCaUrl: https://pebble:14000/dir');
    expect(values).toContain('publicIngressIpv4: 8.8.4.4');
    expect(values).toContain('namespace: compartment-managed-e2e-build');
    expect(values).toContain(`digest: sha256:${'e'.repeat(64)}`);
    expect(values).not.toContain('compartment.localhost');
    expect(values).not.toContain('custom-http');
  });

  it('rejects an unusable bundled registry Service address', () => {
    expect(() => renderK3dRegistryConfig('', '10.43.12.34')).toThrow('Bundled registry host is required');
    for (const clusterIp of ['', 'None', 'registry.compartment.svc', '2001:db8::1']) {
      expect(() =>
        renderK3dRegistryConfig('compartment-compartment-registry-auth.compartment.svc:5000', clusterIp),
      ).toThrow('must have an IPv4 clusterIP');
    }
  });
});
