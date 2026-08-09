import { describe, expect, it } from 'vitest';

import {
  parseDeploymentReferences,
  parseRestartedContainerReferences,
  parseUnreadyDeploymentReferences,
  parseUnreadyPodReferences,
} from './collect-platform-k3d-e2e-diagnostics.mjs';
import {
  createLoadPodOverrides,
  findDegradedProductDeployments,
  parseNonNegativeInteger,
  parseProductLogBufferBytes,
  parseProductLogBufferMaxBytes,
} from './run-platform-k3d-product-log-gate.mjs';
import { findReadyNonTerminatingPodName, isDeploymentConverged } from './run-platform-k3d-retained-state-gate.mjs';

describe('platform k3d diagnostics and product-log gates', () => {
  it('waits for the current deployment generation and selects only its stable pod', () => {
    expect(
      isDeploymentConverged(
        JSON.stringify({
          metadata: { generation: 3 },
          spec: { replicas: 1 },
          status: {
            availableReplicas: 1,
            observedGeneration: 2,
            readyReplicas: 1,
            replicas: 1,
            updatedReplicas: 1,
          },
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentConverged(
        JSON.stringify({
          metadata: { generation: 3 },
          spec: { replicas: 1 },
          status: {
            availableReplicas: 1,
            observedGeneration: 3,
            readyReplicas: 1,
            replicas: 1,
            updatedReplicas: 1,
          },
        }),
      ),
    ).toBe(true);
    expect(
      findReadyNonTerminatingPodName(
        JSON.stringify({
          items: [
            {
              metadata: { deletionTimestamp: '2026-08-03T19:55:39Z', name: 'postgres-old' },
              status: { conditions: [{ status: 'True', type: 'Ready' }], phase: 'Running' },
            },
            {
              metadata: { name: 'postgres-current' },
              status: { conditions: [{ status: 'True', type: 'Ready' }], phase: 'Running' },
            },
          ],
        }),
      ),
    ).toBe('postgres-current');
  });

  it('parses namespaced deployment references', () => {
    expect(parseDeploymentReferences('compartment/api\ncpt-project/app\n')).toEqual([
      { name: 'api', namespace: 'compartment' },
      { name: 'app', namespace: 'cpt-project' },
    ]);
    expect(() => parseDeploymentReferences('missing-namespace')).toThrow('Invalid Kubernetes deployment reference');
  });

  it('selects only unavailable deployments and unready pods for detailed diagnostics', () => {
    expect(
      parseUnreadyDeploymentReferences(
        JSON.stringify({
          items: [
            {
              metadata: { name: 'console', namespace: 'compartment' },
              spec: { replicas: 1 },
              status: { availableReplicas: 0 },
            },
            {
              metadata: { name: 'api', namespace: 'compartment' },
              spec: { replicas: 1 },
              status: { availableReplicas: 1 },
            },
            {
              metadata: { name: 'stopped', namespace: 'cpt-app' },
              spec: { replicas: 0 },
              status: {},
            },
          ],
        }),
      ),
    ).toEqual([{ name: 'console', namespace: 'compartment' }]);
    expect(
      parseUnreadyPodReferences(
        JSON.stringify({
          items: [
            {
              metadata: { name: 'console-broken', namespace: 'compartment' },
              status: { conditions: [{ status: 'False', type: 'Ready' }], phase: 'Running' },
            },
            {
              metadata: { name: 'api-ready', namespace: 'compartment' },
              status: { conditions: [{ status: 'True', type: 'Ready' }], phase: 'Running' },
            },
            { metadata: { name: 'completed-job', namespace: 'cpt-app' }, status: { phase: 'Succeeded' } },
          ],
        }),
      ),
    ).toEqual([{ name: 'console-broken', namespace: 'compartment' }]);
  });

  it('selects restarted application containers for previous-log diagnostics', () => {
    expect(
      parseRestartedContainerReferences(
        JSON.stringify({
          items: [
            {
              metadata: { name: 'edge-broken', namespace: 'compartment' },
              status: {
                containerStatuses: [
                  { name: 'edge', restartCount: 5 },
                  { name: 'sidecar', restartCount: 0 },
                ],
              },
            },
            { metadata: { name: 'pending', namespace: 'compartment' }, status: {} },
          ],
        }),
      ),
    ).toEqual([{ containerName: 'edge', podName: 'edge-broken', namespace: 'compartment' }]);
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

  it('projects restricted Pod Security for product-log load Pods', () => {
    const overrides = createLoadPodOverrides('app-deployment');

    expect(overrides.spec.securityContext).toEqual({
      runAsGroup: 10_001,
      runAsNonRoot: true,
      runAsUser: 10_001,
      seccompProfile: { type: 'RuntimeDefault' },
    });
    expect(overrides.spec.containers[0].securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      privileged: false,
    });
  });
});
