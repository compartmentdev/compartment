import { describe, expect, it } from 'vitest';
import { buildCompartmentArtifactRegistryAddress } from '../src';

describe('artifact registry address helpers', (): void => {
  it('builds the canonical registry host:port address', (): void => {
    expect(buildCompartmentArtifactRegistryAddress('127.0.0.1', 5517)).toBe('127.0.0.1:5517');
  });
});
