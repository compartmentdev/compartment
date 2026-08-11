import { describe, expect, it } from 'vitest';
import {
  workerClaimOrganizationQuotaReconcileResponseSchema,
  workerCompleteOrganizationQuotaReconcileRequestSchema,
} from '../src';

describe('internal organization quota reconciliation contract', (): void => {
  it('accepts an immutable organization target without usage counters', (): void => {
    expect(
      workerClaimOrganizationQuotaReconcileResponseSchema.parse({
        target: { leaseId: 'oql_1', organizationId: 'org_1' },
      }),
    ).toEqual({ target: { leaseId: 'oql_1', organizationId: 'org_1' } });
    expect((): void => {
      workerClaimOrganizationQuotaReconcileResponseSchema.parse({
        target: { leaseId: 'oql_1', organizationId: 'org_1', usage: { cpu: '1' } },
      });
    }).toThrow();
  });

  it('requires failure context and rejects unknown completion fields', (): void => {
    expect((): void => {
      workerCompleteOrganizationQuotaReconcileRequestSchema.parse({
        leaseId: 'oql_1',
        organizationId: 'org_1',
        status: 'failed',
      });
    }).toThrow('message is required');
    expect((): void => {
      workerCompleteOrganizationQuotaReconcileRequestSchema.parse({
        leaseId: 'oql_1',
        organizationId: 'org_1',
        status: 'succeeded',
        usage: 1,
      });
    }).toThrow();
  });
});
