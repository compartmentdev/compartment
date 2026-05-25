import { it } from 'vitest';
import { consoleE2eCommandTimeoutMs, expectConsoleE2e } from './self-hosted-user-setup-console-e2e.harness';
import {
  describeSelfHostedUserSetupE2e,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';

const consoleE2eTimeoutMs: number = selfHostedUserSetupTimeoutMs + consoleE2eCommandTimeoutMs;

describeSelfHostedUserSetupE2e('console Playwright end-to-end', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  it(
    'installs the system and passes the console smoke flow',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();

      await expectConsoleE2e(runtime);
    },
    consoleE2eTimeoutMs,
  );
});
