import { describe, expect, it } from 'vitest';

import {
  isConsoleReadyStatus,
  parseK3dClusterNames,
  parseLoadedImageRefs,
  readPlatformK3dCommand,
  renderK3dRegistryConfig,
  renderPlatformK3dValues,
} from './platform-k3d-e2e.mjs';

describe('platform k3d e2e command boundary', () => {
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
    expect(values).toContain('repository: k3d-compartment-e2e-registry:15500/compartment-api');
    expect(values).toContain(`digest: sha256:${'a'.repeat(64)}`);
    expect(values).not.toContain('ports:\n  http: 18080');
    expect(values).not.toContain('startupStage:');
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
