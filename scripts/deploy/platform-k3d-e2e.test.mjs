import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCertManagerReadinessWaitCommands,
  buildPlatformK3dClusterCreateArgs,
  isConsoleReadyStatus,
  isTransientKubernetesApiFailure,
  parseK3dClusterNames,
  parseLoadedImageRefs,
  readPlatformK3dCommand,
  readPlatformK3dCertManagerManifestUrl,
  readPlatformK3dIngressNginxManifestUrl,
  readPlatformK3dEnvironment,
  renderManagedPlatformK3dValues,
  renderPlatformK3dValues,
  runKubectlWithTransientApiRetry,
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
  withPlatformK3dProcessLock,
} from './platform-k3d-e2e-support.mjs';

function createTestImageDigests() {
  return {
    api: `sha256:${'a'.repeat(64)}`,
    caddy: `sha256:${'d'.repeat(64)}`,
    'dns01-solver': `sha256:${'e'.repeat(64)}`,
    edge: `sha256:${'c'.repeat(64)}`,
    worker: `sha256:${'b'.repeat(64)}`,
  };
}

describe('platform k3d e2e command boundary', () => {
  it('routes public ports through the k3d load balancer with Traefik enabled', () => {
    const args = buildPlatformK3dClusterCreateArgs();

    expect(args).toContain('127.0.0.1:18080:80@loadbalancer');
    expect(args).toContain('127.0.0.1:18443:443@loadbalancer');
    expect(args.join(' ')).not.toContain('disable=traefik');
    expect(args.join(' ')).not.toContain('30080@server');
    expect(args).toContain('rancher/k3s:v1.33.2-k3s1');
    expect(
      args.some((arg) =>
        arg.endsWith(
          '/.compartment/compartment-e2e-registry-test-ca.crt:/etc/ssl/certs/compartment-registry-test-ca.crt@server:*;agent:*',
        ),
      ),
    ).toBe(true);
    expect(args).toContain('10.43.250.250:registry.compartment.localhost');
    expect(args).toContain('120s');
    expect(args.join(' ')).not.toContain('30443@server');
    expect(readPlatformK3dCertManagerManifestUrl()).toBe(
      'https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml',
    );
    expect(readPlatformK3dIngressNginxManifestUrl()).toBe(
      'https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.3/deploy/static/provider/baremetal/deploy.yaml',
    );
  });

  it('retries only transient Kubernetes API availability failures', async () => {
    const waits = [];
    const commandRunner = vi
      .fn()
      .mockReturnValueOnce({
        status: 1,
        stderr: 'Error from server (ServiceUnavailable): unable to handle request (get nodes)',
        stdout: '',
      })
      .mockReturnValueOnce({
        status: 1,
        stderr: 'The connection to the server 127.0.0.1:6443 was refused',
        stdout: '',
      })
      .mockReturnValue({ status: 0, stderr: '', stdout: 'ok' });

    await runKubectlWithTransientApiRetry(['wait', 'nodes'], {
      commandRunner,
      wait: async (milliseconds) => waits.push(milliseconds),
    });

    expect(commandRunner).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1_000, 2_000]);
    expect(
      isTransientKubernetesApiFailure({
        status: 1,
        stderr: 'timed out waiting for the condition',
        stdout: '',
      }),
    ).toBe(false);
    expect(isTransientKubernetesApiFailure({ status: 1, stderr: 'not ready', stdout: '' })).toBe(false);
    expect(isTransientKubernetesApiFailure({ status: 1, stderr: 'not ready', stdout: '' }, true)).toBe(true);
    expect(
      isTransientKubernetesApiFailure({
        status: 1,
        stderr: 'Error from server (NotFound): deployments.apps "traefik" not found',
        stdout: '',
      }),
    ).toBe(false);
    expect(
      isTransientKubernetesApiFailure(
        {
          status: 1,
          stderr: 'Error from server (NotFound): deployments.apps "traefik" not found',
          stdout: '',
        },
        false,
        true,
      ),
    ).toBe(true);
    expect(
      isTransientKubernetesApiFailure({
        status: 1,
        stderr: 'failed calling webhook "validate.example": dial tcp 10.43.0.7:443: connect: connection refused',
        stdout: '',
      }),
    ).toBe(false);
    expect(
      isTransientKubernetesApiFailure({
        status: 1,
        stderr: 'Get "https://127.0.0.1:6443/api": dial tcp 127.0.0.1:6443: connect: connection refused',
        stdout: '',
      }),
    ).toBe(true);
  });

  it('waits for cert-manager deployments and a populated webhook endpoint', () => {
    expect(buildCertManagerReadinessWaitCommands(90)).toEqual([
      [
        '--context',
        'k3d-compartment-e2e',
        '--namespace',
        'cert-manager',
        'wait',
        'deployment/cert-manager',
        'deployment/cert-manager-webhook',
        'deployment/cert-manager-cainjector',
        '--for=condition=Available',
        '--timeout=90s',
      ],
      [
        '--context',
        'k3d-compartment-e2e',
        '--namespace',
        'cert-manager',
        'wait',
        'endpoints/cert-manager-webhook',
        '--for=jsonpath={.subsets[0].addresses[0].ip}',
        '--timeout=90s',
      ],
    ]);
  });

  it('removes container-owned anonymous volumes during cleanup', () => {
    expect(buildDockerContainerRemovalArgs('managed-caddy-build')).toEqual([
      'container',
      'rm',
      '--force',
      '--volumes',
      'managed-caddy-build',
    ]);
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

  it('writes the operator values consumed by the production install command', () => {
    const values = renderPlatformK3dValues(createTestImageDigests());

    expect(values).toContain('baseDomain: compartment.localhost');
    expect(values).toContain('publicProtocol: http');
    expect(values).toContain('className: traefik');
    expect(values).not.toContain('NodePort');
    expect(values).not.toContain('service:');
    expect(values).toContain('namespace: compartment-build');
    expect(values).toContain('clusterIP: 10.43.250.250');
    expect(values).not.toContain('hostname:');
    expect(values).toContain('name: compartment-registry-test-issuer');
    expect(values).toContain('repository: k3d-compartment-e2e-registry:15500/compartment-api');
    expect(values).toContain(`digest: sha256:${'a'.repeat(64)}`);
    expect(values).not.toContain('ports:\n  http: 18080');
    expect(values).not.toContain('startupStage:');
  });

  it('enables the gVisor RuntimeClass only for an opted-in e2e cluster', () => {
    expect(renderPlatformK3dValues(createTestImageDigests())).not.toContain('tenantRuntime:');
    expect(renderPlatformK3dValues(createTestImageDigests(), true)).toContain(
      'tenantRuntime:\n  runtimeClassName: gvisor\n  createRuntimeClass: true\n  runtimeHandler: runsc',
    );
  });

  it('writes isolated managed-install values with a typed ingress endpoint and verified digests', () => {
    const values = renderManagedPlatformK3dValues(createTestImageDigests());

    expect(values).toContain('className: traefik');
    expect(values).toContain('type: A');
    expect(values).toContain('value: 8.8.4.4');
    expect(values).toContain('targetsJson:');
    expect(values).toContain('stagingUrl: https://pebble.compartment-managed-e2e.svc.cluster.local:14000/dir');
    expect(values).toContain('namespace: compartment-managed-e2e-build');
    expect(values).toContain(`digest: sha256:${'d'.repeat(64)}`);
    expect(values).not.toContain('compartment.localhost');
  });
});
