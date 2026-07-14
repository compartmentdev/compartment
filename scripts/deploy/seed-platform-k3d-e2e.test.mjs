import { describe, expect, it } from 'vitest';

import {
  buildSeedEnvironment,
  parseCompatibilityNodeResult,
  parseInstallResult,
  readSeedPlatformOptions,
} from './seed-platform-k3d-e2e.mjs';

describe('platform k3d seed boundary', () => {
  it('requires the GitHub environment output path', () => {
    expect(() => readSeedPlatformOptions([], {})).toThrow('GITHUB_ENV is required');
    expect(() => readSeedPlatformOptions([], { GITHUB_ENV: '  ' })).toThrow('GITHUB_ENV is required');
    expect(() => readSeedPlatformOptions(['extra'], { GITHUB_ENV: '/tmp/github-env' })).toThrow('Usage:');
    expect(readSeedPlatformOptions([], { GITHUB_ENV: '/tmp/github-env' })).toEqual({
      githubEnvPath: '/tmp/github-env',
    });
  });

  it('rejects malformed or mismatched install output', () => {
    expect(() => parseInstallResult('not-json', 'admin@compartment.test')).toThrow('did not return JSON');
    expect(() => parseInstallResult('{}', 'admin@compartment.test')).toThrow('unexpected result');
  });

  it('validates the compatibility node registration boundary', () => {
    expect(() => parseCompatibilityNodeResult('not-json')).toThrow('did not return JSON');
    expect(() => parseCompatibilityNodeResult('{}')).toThrow('unexpected result');
    const result = {
      node: { id: 'node_123', name: 'platform-k3d-compatibility' },
      registeredAt: '2026-07-13T15:00:00.000Z',
    };
    expect(parseCompatibilityNodeResult(JSON.stringify(result))).toEqual(result);
  });

  it('accepts the expected install result and emits the suite contract', () => {
    const result = {
      adminEmail: 'admin@compartment.test',
      compartmentUrl: 'http://console.compartment.localhost:18080',
      organization: { slug: 'platform-e2e' },
    };
    expect(parseInstallResult(JSON.stringify(result), result.adminEmail)).toEqual(result);
    expect(buildSeedEnvironment(result.adminEmail, 'generated-password')).toContain(
      'COMPARTMENT_E2E_API_URL=http://console.compartment.localhost:18080',
    );
    expect(buildSeedEnvironment(result.adminEmail, 'generated-password')).toContain(
      'COMPARTMENT_E2E_SEED_ADMIN_PASSWORD=generated-password',
    );
  });
});
