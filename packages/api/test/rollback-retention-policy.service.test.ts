import { describe, expect, it } from 'vitest';
import { rollbackRetentionConfiguredPolicySchema } from '@compartment/contracts';
import { resolveEffectiveRollbackRetentionPolicy } from '../src/services/rollback-retention-policy.service';

describe('rollback retention policy service', (): void => {
  it('inherits the instance keep-last policy', (): void => {
    expect(
      resolveEffectiveRollbackRetentionPolicy(
        {
          limit: null,
          mode: 'inherit',
        },
        {
          limit: 5,
          mode: 'keep_last',
        },
      ),
    ).toEqual({
      limit: 5,
      mode: 'keep_last',
    });
  });

  it('preserves explicit indefinite overrides', (): void => {
    expect(
      resolveEffectiveRollbackRetentionPolicy(
        {
          limit: null,
          mode: 'indefinite',
        },
        {
          limit: 5,
          mode: 'keep_last',
        },
      ),
    ).toEqual({
      limit: null,
      mode: 'indefinite',
    });
  });

  it('preserves explicit keep-last overrides', (): void => {
    expect(
      resolveEffectiveRollbackRetentionPolicy(
        {
          limit: 2,
          mode: 'keep_last',
        },
        {
          limit: null,
          mode: 'indefinite',
        },
      ),
    ).toEqual({
      limit: 2,
      mode: 'keep_last',
    });
  });

  it('rejects invalid configured policy combinations', (): void => {
    expect(
      rollbackRetentionConfiguredPolicySchema.safeParse({
        limit: null,
        mode: 'keep_last',
      }).success,
    ).toBe(false);
    expect(
      rollbackRetentionConfiguredPolicySchema.safeParse({
        limit: 3,
        mode: 'inherit',
      }).success,
    ).toBe(false);
  });
});
