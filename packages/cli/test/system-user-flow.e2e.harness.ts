import type { DeploymentReadSummary } from '@compartment/contracts';
import {
  selfHostedUserSetupAppListeningLogText,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import type { SelfHostedUserSetupRuntime } from './self-hosted-user-setup.e2e.harness';

export class SystemUserFlowContext {
  runtime!: SelfHostedUserSetupRuntime;
  advertisedCompartmentUrl!: string;
  app!: SelfHostedUserSetupAppFixture;
  admin!: SelfHostedUserSetupCli;
  viewer!: SelfHostedUserSetupCli;
  routeUrl!: string;
  activeDeployment!: DeploymentReadSummary;
  adminAppSessionCookie!: string;
  promotedDeploymentId!: string;
  completedCaseCount: number = 0;
}

export const viewerEmail: string = 'viewer-self-hosted-e2e@example.com';
export const viewerPassword: string = ['Viewer', 'Passw0rd!'].join('');
export const appMessage: string = 'hello-from-self-hosted-e2e';
export const appBuildMessage: string = 'build-from-self-hosted-e2e';
export const rollbackMessage: string = 'hello-before-rollback';
export const rollbackBuildMessage: string = 'build-before-rollback';
export const explicitProjectName: string = 'self-hosted-e2e-explicit';
export const renamedProjectName: string = 'self-hosted-e2e-app-renamed';
export const directFlagValue: string = 'direct-from-variable-set';
export const beforeBackupValue: string = 'before-backup';
export const afterBackupValue: string = 'after-backup';
export const restoredResourceName: string = 'postgres-copy';
export const appListeningLogText: string = selfHostedUserSetupAppListeningLogText;
export const oidcIssuerHost: string = 'issuer.self-hosted-e2e.example.com';
export const oidcIssuerUrl: string = `https://${oidcIssuerHost}`;
export const permissionDeniedMessage: string = 'The current principal is not allowed to perform this operation.';
export const noConfiguredLoginMessage: string = 'No Compartment login is configured.';
export const loggedOutRemoteMessage: string = 'You are not logged in for remote';
export const validSessionRequiredMessage: string = 'A valid session is required.';
export const invalidRollbackRetentionMessage: string =
  'rollback retention must be inherit, indefinite, or a positive integer.';
export const missingVariableGroupMessage: string =
  'The requested variable group was not found in the current organization.';
export const missingServiceMessage: string = 'The requested service was not found.';
export const missingResourceBackupMessage: string = 'The requested resource backup was not found.';
export const archivedProjectMessage: string = 'The requested project is archived.';
