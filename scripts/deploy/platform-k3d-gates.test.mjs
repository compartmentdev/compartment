import { describe, expect, it } from 'vitest';

import { parseDeploymentReferences } from './collect-platform-k3d-e2e-diagnostics.mjs';
import {
  findDegradedProductDeployments,
  parseNonNegativeInteger,
  parseProductLogBufferBytes,
  parseProductLogBufferMaxBytes,
} from './run-platform-k3d-product-log-gate.mjs';

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

  it('reads the product-log buffer gauge instead of allocated disk segments', () => {
    const metrics = `vector_buffer_byte_size{buffer_id="metrics",buffer_type="memory"} 0
vector_buffer_byte_size{buffer_id="product_store",component_id="product_store",buffer_type="disk"} 132581856 1234
vector_buffer_max_byte_size{component_id="product_store",buffer_type="disk"} 268435488 1234`;
    expect(parseProductLogBufferBytes(metrics)).toBe(132_581_856);
    expect(parseProductLogBufferMaxBytes(metrics)).toBe(268_435_488);
    expect(() => parseProductLogBufferBytes('vector_buffer_events{buffer_id="product_store"} 50')).toThrow(
      'Unable to read product-log buffer size',
    );
  });

  it('finds unavailable product deployments without treating stopped resources as degraded', () => {
    const deployments = JSON.stringify({
      items: [
        {
          metadata: { labels: { app: 'resource' }, name: 'stopped-resource', namespace: 'cpt-one' },
          spec: { replicas: 0 },
          status: {},
        },
        {
          metadata: { labels: { app: 'resource' }, name: 'unavailable-resource', namespace: 'cpt-one' },
          spec: { replicas: 1 },
          status: {},
        },
        {
          metadata: { labels: { app: 'application' }, name: 'unavailable-app', namespace: 'cpt-two' },
          spec: { replicas: 1 },
          status: {},
        },
        {
          metadata: { labels: { app: 'application' }, name: 'ready-app', namespace: 'cpt-three' },
          spec: { replicas: 1 },
          status: { availableReplicas: 1 },
        },
        {
          metadata: { labels: { app: 'application' }, name: 'platform-api', namespace: 'compartment' },
          spec: { replicas: 1 },
          status: {},
        },
      ],
    });
    expect(findDegradedProductDeployments(deployments).map((deployment) => deployment.metadata.name)).toEqual([
      'unavailable-resource',
      'unavailable-app',
    ]);
  });
});
