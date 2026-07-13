import { describe, expect, it } from 'vitest';

import {
  isConsoleReadyStatus,
  parseK3dClusterNames,
  parseLoadedImageRefs,
  readPlatformK3dCommand,
  renderK3dRegistryConfig,
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
  });

  it('rejects unknown actions and malformed options', () => {
    expect(() => readPlatformK3dCommand([])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['restart'])).toThrow('Usage:');
    expect(() => readPlatformK3dCommand(['down', 'extra'])).toThrow('Usage:');
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

  it('rejects an unusable bundled registry Service address', () => {
    expect(() => renderK3dRegistryConfig('', '10.43.12.34')).toThrow('Bundled registry host is required');
    for (const clusterIp of ['', 'None', 'registry.compartment.svc', '2001:db8::1']) {
      expect(() =>
        renderK3dRegistryConfig('compartment-compartment-registry-auth.compartment.svc:5000', clusterIp),
      ).toThrow('must have an IPv4 clusterIP');
    }
  });
});
