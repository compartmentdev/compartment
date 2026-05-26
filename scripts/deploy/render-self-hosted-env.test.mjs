import { describe, expect, it } from 'vitest';

import { renderSelfHostedEnv } from './render-self-hosted-env.mjs';

describe('renderSelfHostedEnv', () => {
  it('replaces runtime image variables and preserves unrelated env lines', () => {
    expect(
      renderSelfHostedEnv({
        primaryTag: 'sha-123',
        templateText: `COMPARTMENT_API_IMAGE=old-api
COMPARTMENT_CADDY_IMAGE=old-caddy
COMPARTMENT_EDGE_IMAGE=old-edge
COMPARTMENT_NODE_VERSION=old-version
COMPARTMENT_RUNTIME_PROBE_IMAGE=old-runtime-probe
COMPARTMENT_WORKER_IMAGE=old-worker
COMPARTMENT_PUBLIC_PORT=443
# comment
`,
      }),
    ).toBe(`COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:sha-123
COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:sha-123
COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:sha-123
COMPARTMENT_NODE_VERSION=sha-123
COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:sha-123
COMPARTMENT_WORKER_IMAGE=ghcr.io/compartmentdev/compartment-worker:sha-123
COMPARTMENT_PUBLIC_PORT=443
# comment
`);
  });

  it('renders Docker Hub image variables when requested', () => {
    expect(
      renderSelfHostedEnv({
        primaryTag: 'sha-123',
        repositoryPrefix: 'docker.io/compartmentdev',
        templateText: `COMPARTMENT_API_IMAGE=old-api
COMPARTMENT_NODE_VERSION=old-version
`,
      }),
    ).toBe(`COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:sha-123
COMPARTMENT_NODE_VERSION=sha-123
`);
  });
});
