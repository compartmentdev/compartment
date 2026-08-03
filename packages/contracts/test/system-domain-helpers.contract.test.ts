import { describe, expect, it } from 'vitest';
import { buildPrivateRegistryHost } from '../src/contracts/system-domain-helpers.contract';

describe('system domain helpers', (): void => {
  it('uses the registry Service address without a base-domain dependency', (): void => {
    const firstAddress: string = [10, 43, 162, 108].join('.');
    const reinstalledAddress: string = [10, 43, 200, 9].join('.');
    expect(buildPrivateRegistryHost(firstAddress)).toBe(firstAddress);
    expect(buildPrivateRegistryHost(reinstalledAddress)).toBe(reinstalledAddress);
  });
});
