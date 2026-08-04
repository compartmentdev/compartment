import { it } from 'vitest';
import {
  type SystemUserFlowAppDeployment,
  createSystemUserFlowContext,
  loginSystemUserFlowAdmin,
  prepareSystemUserFlowAppDeployment,
  prepareSystemUserFlowVariables,
} from './system-user-flow.shared.e2e.harness';
import {
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
} from './self-hosted-user-setup.e2e.harness';
import { registerSystemUserFlowStatefulTeardownCases } from './system-user-flow.stateful-teardown.e2e-cases';
import { SystemUserFlowContext } from './system-user-flow.e2e.harness';

export type SystemUserFlowStatefulShard = 'backup-rollback' | 'access-audit';

export function registerSystemUserFlowStatefulShard(shard: SystemUserFlowStatefulShard): void {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();
  const context: SystemUserFlowContext = new SystemUserFlowContext();

  it(
    'bootstraps the stateful system user flow fixture',
    async (): Promise<void> => {
      const initializedContext: SystemUserFlowContext = await createSystemUserFlowContext(setup);
      Object.assign(context, initializedContext);
      await loginSystemUserFlowAdmin(context);
      await prepareSystemUserFlowVariables(context.admin, context.app);
      const deployment: SystemUserFlowAppDeployment = await prepareSystemUserFlowAppDeployment(
        context.admin,
        context.app,
        context.runtime,
        context.advertisedCompartmentUrl,
      );
      context.routeUrl = deployment.routeUrl;
      context.activeDeployment = deployment.activeDeployment;
      context.promotedDeploymentId = deployment.activeDeployment.id;
      context.adminAppSessionCookie = deployment.adminAppSessionCookie;
      context.completedCaseCount = 4;
    },
    selfHostedUserSetupTimeoutMs,
  );

  registerSystemUserFlowStatefulTeardownCases(context, shard);
}
