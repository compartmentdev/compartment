import { describe, expect, it } from 'vitest';
import { projectNetworkPolicy } from '../src/project-network-policy';

describe('project NetworkPolicy configuration', (): void => {
  it('creates a port-free bootstrap baseline', (): void => {
    expect(
      projectNetworkPolicy(
        {
          COMPARTMENT_EDGE_NAMESPACE: 'edge',
          COMPARTMENT_KUBE_POD_CIDR: ['10', '42', '0', '0/16'].join('.'),
          COMPARTMENT_KUBE_SERVICE_CIDR: ['10', '43', '0', '0/16'].join('.'),
        },
        { applicationPorts: [], resourcePorts: [] },
      ),
    ).toMatchObject({ applicationPorts: [], resourcePorts: [] });
  });
});
