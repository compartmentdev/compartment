import { describe, expect, it } from 'vitest';
import { parseKubernetesIngressTargetsJson } from '../src/services/kubernetes-install-ingress-targets.service';

describe('retained Kubernetes Ingress targets', (): void => {
  const ipv4: string = [8, 8, 8, 8].join('.');

  it('rejects flattened hostnames and malformed address targets', (): void => {
    expect((): void => {
      parseKubernetesIngressTargetsJson(
        JSON.stringify([{ type: 'hostname', value: ipv4 }]),
        'The retained install-state Secret',
      );
    }).toThrow('The retained install-state Secret has invalid ingress targets.');
    expect((): void => {
      parseKubernetesIngressTargetsJson(
        JSON.stringify([{ type: 'A', value: '999.1.1.1' }]),
        'The retained install-state Secret',
      );
    }).toThrow('The retained install-state Secret has invalid ingress targets.');
    expect((): void => {
      parseKubernetesIngressTargetsJson(
        JSON.stringify([{ type: 'AAAA', value: 'not:ipv6' }]),
        'The retained install-state Secret',
      );
    }).toThrow('The retained install-state Secret has invalid ingress targets.');
  });

  it('preserves a valid hostname target without resolving it', (): void => {
    expect(
      parseKubernetesIngressTargetsJson(
        JSON.stringify([{ type: 'hostname', value: 'shared-lb.example.com' }]),
        'The retained install-state Secret',
      ),
    ).toEqual([{ type: 'hostname', value: 'shared-lb.example.com' }]);
  });
});
