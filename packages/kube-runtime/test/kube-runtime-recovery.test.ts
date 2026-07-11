import { afterEach, describe, expect, it, vi } from 'vitest';
import { KubeRuntimeRecoveryHarness, type RecoveryKillPoint, type RecoveryResult } from './kube-runtime-test.harness';

const killPoints: RecoveryKillPoint[] = [
  'after-desired-before-apply',
  'after-apply-before-pending',
  'after-pending-before-ready',
  'during-informer-callback',
];

describe('T9 restart recovery', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });
  for (const killPoint of killPoints) {
    it(`converges exactly once after ${killPoint}`, async (): Promise<void> => {
      const result: RecoveryResult = await new KubeRuntimeRecoveryHarness().run(killPoint);
      expect(result).toMatchObject({
        objectNames: ['app-dep-01jz-271c08c7e603c156'],
        rowCount: 1,
        state: 'active',
      });
      expect(result.observedAt).not.toBeNull();
      expect(result.audit).toHaveLength(killPoint === 'during-informer-callback' ? 1 : 0);
    });
  }
});
