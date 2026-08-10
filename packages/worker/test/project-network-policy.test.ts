import { describe, expect, it } from 'vitest';
import { projectNetworkPolicy, type ProjectNetworkPolicyEnvironment } from '../src/project-network-policy';
import { testEdgePodLabels, testEdgePodLabelsJson } from './worker-config-test.fixtures';

describe('project NetworkPolicy configuration', (): void => {
  it('creates a port-free bootstrap baseline', (): void => {
    expect(projectNetworkPolicy(networkPolicyEnvironment(), { applicationPorts: [], resourcePorts: [] })).toMatchObject(
      { applicationPorts: [], resourcePorts: [] },
    );
  });

  it('takes the ingress peer from the labels the chart puts on the Caddy Pods', (): void => {
    expect(
      projectNetworkPolicy(networkPolicyEnvironment(), { applicationPorts: [8080], resourcePorts: [] }).edgePodLabels,
    ).toEqual(testEdgePodLabels);
  });

  it.each(['', '{}', 'caddy', '{"app.kubernetes.io/component":""}', '[]'])(
    'refuses to project a peer from %j instead of narrowing it to nothing',
    (edgePodLabels: string): void => {
      expect((): void => {
        projectNetworkPolicy(
          { ...networkPolicyEnvironment(), COMPARTMENT_EDGE_POD_LABELS: edgePodLabels },
          {
            applicationPorts: [8080],
            resourcePorts: [],
          },
        );
      }).toThrow('COMPARTMENT_EDGE_POD_LABELS');
    },
  );
});

function networkPolicyEnvironment(): ProjectNetworkPolicyEnvironment {
  return {
    COMPARTMENT_EDGE_NAMESPACE: 'edge',
    COMPARTMENT_EDGE_POD_LABELS: testEdgePodLabelsJson,
    COMPARTMENT_KUBE_POD_CIDR: ['10', '42', '0', '0/16'].join('.'),
    COMPARTMENT_KUBE_SERVICE_CIDR: ['10', '43', '0', '0/16'].join('.'),
  };
}
