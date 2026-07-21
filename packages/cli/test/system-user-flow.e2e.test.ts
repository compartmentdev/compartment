import { describeSelfHostedUserSetupE2e } from './self-hosted-user-setup.e2e.harness';
import { registerSystemUserFlowDeployLifecycleCases } from './system-user-flow.deploy-lifecycle.e2e-cases';

describeSelfHostedUserSetupE2e('self-hosted system user flow end-to-end', (): void => {
  registerSystemUserFlowDeployLifecycleCases();
});
