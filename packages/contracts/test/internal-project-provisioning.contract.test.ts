import { describe, expect, it } from 'vitest';
import {
  workerClaimProjectProvisioningResponseSchema,
  workerClaimProjectProvisioningV2ResponseSchema,
  workerCompleteProjectProvisioningRequestSchema,
  workerCompleteProjectProvisioningV2RequestSchema,
} from '../src';

describe('project provisioning contracts', (): void => {
  it('accepts one leased project target or an empty claim', (): void => {
    expect(
      workerClaimProjectProvisioningResponseSchema.safeParse({
        target: { leaseId: 'kpl_1', namespaceId: 'prj_1', projectId: 'prj_1' },
      }).success,
    ).toBe(true);
    expect(workerClaimProjectProvisioningResponseSchema.safeParse({ target: null }).success).toBe(true);
    expect(
      workerClaimProjectProvisioningV2ResponseSchema.safeParse({
        target: { action: 'teardown', leaseId: 'kpl_1', namespaceId: 'prj_1', projectId: 'prj_1' },
      }).success,
    ).toBe(true);
  });

  it('keeps cleanup inside the ordinary provisioning lease', (): void => {
    const base: { leaseId: string; namespaceId: string; projectId: string } = {
      leaseId: 'kpl_1',
      namespaceId: 'prj_1',
      projectId: 'prj_1',
    };
    expect(
      workerClaimProjectProvisioningV2ResponseSchema.safeParse({ target: { ...base, action: 'cleanup' } }).success,
    ).toBe(false);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({
        action: 'cleanup',
        leaseId: 'kpl_1',
        projectId: 'prj_1',
        status: 'succeeded',
      }).success,
    ).toBe(false);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({
        action: 'provision',
        cleanupRequired: true,
        leaseId: 'kpl_1',
        projectId: 'prj_1',
        status: 'succeeded',
      }).success,
    ).toBe(false);
  });

  it('requires a message only for failed completion', (): void => {
    const base: { leaseId: string; projectId: string } = {
      leaseId: 'kpl_1',
      projectId: 'prj_1',
    };
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        status: 'failed',
      }).success,
    ).toBe(false);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        message: 'denied',
        status: 'failed',
      }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningRequestSchema.safeParse({
        ...base,
        status: 'succeeded',
      }).success,
    ).toBe(true);
    expect(workerCompleteProjectProvisioningRequestSchema.safeParse({ ...base, status: 'running' }).success).toBe(true);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({ ...base, action: 'teardown', status: 'running' })
        .success,
    ).toBe(true);
    expect(workerCompleteProjectProvisioningRequestSchema.safeParse({ ...base, action: 'teardown' }).success).toBe(
      false,
    );
  });
});
