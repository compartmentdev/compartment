import { describe, expect, it } from 'vitest';
import { workerClaimProjectProvisioningResponseSchema, workerCompleteProjectProvisioningRequestSchema } from '../src';

describe('project provisioning contracts', (): void => {
  it('accepts one leased project target or an empty claim', (): void => {
    expect(
      workerClaimProjectProvisioningResponseSchema.safeParse({
        target: { leaseId: 'kpl_1', namespaceId: 'prj_1', projectId: 'prj_1' },
      }).success,
    ).toBe(true);
    expect(workerClaimProjectProvisioningResponseSchema.safeParse({ target: null }).success).toBe(true);
  });

  it('requires a message only for failed completion', (): void => {
    const base: { leaseId: string; projectId: string } = { leaseId: 'kpl_1', projectId: 'prj_1' };
    expect(workerCompleteProjectProvisioningRequestSchema.safeParse({ ...base, status: 'failed' }).success).toBe(false);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({ ...base, message: 'denied', status: 'failed' })
        .success,
    ).toBe(true);
    expect(workerCompleteProjectProvisioningRequestSchema.safeParse({ ...base, status: 'succeeded' }).success).toBe(
      true,
    );
  });
});
