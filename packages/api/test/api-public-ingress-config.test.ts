import { describe, expect, it } from 'vitest';
import { readApiPublicIngressConfig } from '../src/api-public-ingress-config';

describe('API public ingress config', (): void => {
  it('rejects mixed hostname and address targets at the environment boundary', (): void => {
    expect((): void => {
      readApiPublicIngressConfig({
        COMPARTMENT_INGRESS_TARGETS_JSON: JSON.stringify([
          { type: 'hostname', value: 'lb.example.net' },
          { type: 'A', value: ['8', '8', '8', '8'].join('.') },
        ]),
      });
    }).toThrow('Ingress targets must contain either hostnames or addresses, not both.');
  });
});
