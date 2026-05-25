import { describe, expect, it } from 'vitest';

import { findImpactedPublicDocsAreas } from './public-docs-map.mjs';

describe('public docs map', () => {
  it('ignores sdk-only query path refactors for operator guide coverage', () => {
    expect(
      findImpactedPublicDocsAreas([
        'packages/sdk/src/services/custom-domain.service.ts',
        'packages/sdk/src/services/deployment-inspect.service.ts',
        'packages/sdk/src/services/deployment-status.service.ts',
        'packages/sdk/src/services/node-runtime-inspect.service.ts',
        'packages/sdk/src/services/node-runtime-logs.service.ts',
        'packages/sdk/src/services/variable-path.service.ts',
        'packages/sdk/src/services/worker-recover-deployments.service.ts',
        'packages/sdk/test/query-paths.service.test.ts',
      ]),
    ).toEqual([]);
  });

  it('still flags deploy, variable, and custom-domain docs for public contract changes', () => {
    expect(
      findImpactedPublicDocsAreas([
        'packages/contracts/src/contracts/deployments.contract.ts',
        'packages/contracts/src/contracts/variables.contract.ts',
        'packages/contracts/src/contracts/custom-domain.contract.ts',
      ]).map((area) => area.key),
    ).toEqual(['deploy-apps', 'variables', 'custom-domains']);
  });
});
