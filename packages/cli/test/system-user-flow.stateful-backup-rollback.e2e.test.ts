import { describeSelfHostedUserSetupE2e } from './self-hosted-user-setup.e2e.harness';
import { registerSystemUserFlowStatefulShard } from './system-user-flow.stateful.e2e.harness';

describeSelfHostedUserSetupE2e('self-hosted system user backup and rollback flow end-to-end', (): void => {
  registerSystemUserFlowStatefulShard('backup-rollback');
});
