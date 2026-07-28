import { describe, expect, it } from 'vitest';
import {
  workerClaimProjectProvisioningV2ResponseSchema,
  workerCompleteProjectProvisioningV2RequestSchema,
} from '../src';

describe('project provisioning contracts', (): void => {
  it('accepts one leased project target or an empty claim', (): void => {
    expect(
      workerClaimProjectProvisioningV2ResponseSchema.safeParse({
        target: {
          action: 'teardown',
          isolationVersion: 1,
          leaseId: 'kpl_1',
          namespaceId: 'prj_1',
          projectId: 'prj_1',
        },
      }).success,
    ).toBe(true);
  });

  it('keeps cleanup inside the ordinary provisioning lease', (): void => {
    const base: { isolationVersion: number; leaseId: string; namespaceId: string; projectId: string } = {
      isolationVersion: 1,
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
    const base: { isolationVersion: number; leaseId: string; projectId: string } = {
      isolationVersion: 1,
      leaseId: 'kpl_1',
      projectId: 'prj_1',
    };
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({
        ...base,
        action: 'provision',
        message: 'denied',
        status: 'failed',
      }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({
        ...base,
        action: 'provision',
        status: 'succeeded',
      }).success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({ ...base, action: 'teardown', status: 'running' })
        .success,
    ).toBe(true);
    expect(
      workerCompleteProjectProvisioningV2RequestSchema.safeParse({ ...base, action: 'teardown', status: 'failed' })
        .success,
    ).toBe(false);
  });
});
