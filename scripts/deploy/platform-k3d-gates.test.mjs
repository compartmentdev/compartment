import { describe, expect, it } from 'vitest';

import { parseDeploymentReferences } from './collect-platform-k3d-e2e-diagnostics.mjs';
import { findDegradedProductDeployments, parseNonNegativeInteger } from './run-platform-k3d-product-log-gate.mjs';

describe('platform k3d diagnostics and product-log gates', () => {
  it('parses namespaced deployment references', () => {
    expect(parseDeploymentReferences('compartment/api\ncpt-project/app\n')).toEqual([
      { name: 'api', namespace: 'compartment' },
      { name: 'app', namespace: 'cpt-project' },
    ]);
    expect(() => parseDeploymentReferences('missing-namespace')).toThrow('Invalid Kubernetes deployment reference');
  });

  it('accepts only non-negative integer command output', () => {
    expect(parseNonNegativeInteger(' 123\n', 'quota')).toBe(123);
    expect(() => parseNonNegativeInteger('1.5', 'quota')).toThrow('Unable to read quota');
  });

  it('finds unavailable product deployments only', () => {
    const deployments = JSON.stringify({
      items: [
        { metadata: { namespace: 'cpt-one' }, spec: { replicas: 1 }, status: { availableReplicas: 0 } },
        { metadata: { namespace: 'cpt-two' }, spec: { replicas: 1 }, status: { availableReplicas: 1 } },
        { metadata: { namespace: 'compartment' }, spec: { replicas: 1 }, status: { availableReplicas: 0 } },
      ],
    });
    expect(findDegradedProductDeployments(deployments)).toHaveLength(1);
  });
});
