import { describe, expect, it } from 'vitest';
import { workerClaimProjectProvisioningResponseSchema, workerCompleteProjectProvisioningRequestSchema } from '../src';

describe('project provisioning contracts', (): void => {
  it('accepts one leased project target or an empty claim', (): void => {
    expect(
      workerClaimProjectProvisioningResponseSchema.safeParse({
        target: { action: 'provision', leaseId: 'kpl_1', namespaceId: 'prj_1', projectId: 'prj_1' },
      }).success,
    ).toBe(true);
    expect(workerClaimProjectProvisioningResponseSchema.safeParse({ target: null }).success).toBe(true);
  });

  it('models durable cleanup claims separately from provisioning work', (): void => {
    const base: { leaseId: string; namespaceId: string; projectId: string } = {
      leaseId: 'kpl_1',
      namespaceId: 'prj_1',
      projectId: 'prj_1',
    };
    expect(
      workerClaimProjectProvisioningResponseSchema.safeParse({ target: { ...base, action: 'provision' } }).success,
    ).toBe(true);
    expect(
      workerClaimProjectProvisioningResponseSchema.safeParse({ target: { ...base, action: 'cleanup' } }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        action: 'provision',
        cleanupRequired: true,
        leaseId: 'kpl_1',
        projectId: 'prj_1',
        status: 'succeeded',
      }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        action: 'cleanup',
        leaseId: 'kpl_1',
        projectId: 'prj_1',
        status: 'succeeded',
      }).success,
    ).toBe(true);
  });

  it('requires a message only for failed completion', (): void => {
    const base: { leaseId: string; projectId: string } = { leaseId: 'kpl_1', projectId: 'prj_1' };
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        action: 'provision',
        cleanupRequired: false,
        status: 'failed',
      }).success,
    ).toBe(false);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        action: 'provision',
        cleanupRequired: false,
        message: 'denied',
        status: 'failed',
      }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        action: 'provision',
        cleanupRequired: false,
        status: 'succeeded',
      }).success,
    ).toBe(true);
  });
});
