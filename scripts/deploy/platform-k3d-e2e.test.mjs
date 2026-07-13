import { describe, expect, it } from 'vitest';

import { isConsoleReadyStatus, parseK3dClusterNames, readPlatformK3dAction } from './platform-k3d-e2e.mjs';

describe('platform k3d e2e command boundary', () => {
  it('accepts only the up and down actions', () => {
    expect(readPlatformK3dAction(['up'])).toBe('up');
    expect(readPlatformK3dAction(['down'])).toBe('down');
    expect(() => readPlatformK3dAction([])).toThrow('Usage:');
    expect(() => readPlatformK3dAction(['up', 'extra'])).toThrow('Usage:');
  });

  it('finds exact cluster names in k3d output', () => {
    expect(parseK3dClusterNames('compartment-e2e  1/1\nother-cluster  1/1\n')).toEqual([
      'compartment-e2e',
      'other-cluster',
    ]);
  });

  it('accepts only the console redirect as ready', () => {
    expect(isConsoleReadyStatus(302)).toBe(true);
    expect(isConsoleReadyStatus(200)).toBe(false);
    expect(isConsoleReadyStatus(503)).toBe(false);
  });
});
