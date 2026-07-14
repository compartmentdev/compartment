import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessGroupListResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  accessRoleListResponseSchema,
  accessRoleResponseSchema,
  activateResponseSchema,
  auditEventListResponseSchema,
  captureVariableGroupResponseSchema,
  createOrganizationResponseSchema,
  deleteSsoOidcProviderResponseSchema,
  deploymentInspectResponseSchema,
  deploymentListResponseSchema,
  deploymentLogsResponseSchema,
  deploymentRunLogsResponseSchema,
  deploymentStatusResponseSchema,
  gitSourceListResponseSchema,
  importVariableGroupResponseSchema,
  importVariablesResponseSchema,
  inviteUserResponseSchema,
  logoutResponseSchema,
  organizationAuthSettingsResponseSchema,
  organizationListResponseSchema,
  organizationSettingsResponseSchema,
  organizationUserResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  projectShowResponseSchema,
  resourceBackupCreateResponseSchema,
  resourceBackupListResponseSchema,
  resourceBackupShowResponseSchema,
  resourceDeleteResponseSchema,
  resourceListResponseSchema,
  resourceLogsResponseSchema,
  resourceResponseSchema,
  resourceRestoreAsResponseSchema,
  resourceRestoreResponseSchema,
  removeUserResponseSchema,
  removeVariableResponseSchema,
  ssoOidcProviderListResponseSchema,
  ssoOidcProviderResponseSchema,
  userListResponseSchema,
  variableGroupBindingResponseSchema,
  variableGroupListResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  variableListResponseSchema,
  variableResponseSchema,
  whoamiCommandResponseSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentSummary,
  type AccessGroupListResponse,
  type AccessGroupListRow,
  type AccessGroupMemberSummary,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AccessRoleListResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type ActivateResponse,
  type AuditEventListResponse,
  type CaptureVariableGroupResponse,
  type CliRemoteListResponse,
  type CliRemoteResponse,
  type CliRemoteSummary,
  type CreateOrganizationResponse,
  type DeleteSsoOidcProviderResponse,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentListResponse,
  type DeploymentReadSummary,
  type DeploymentRunLogLine,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentStatusResponse,
  type GitSourceListResponse,
  type ImportVariableGroupResponse,
  type ImportVariablesResponse,
  type InviteUserResponse,
  type LogoutResponse,
  type OrganizationAuthSettingsResponse,
  type OrganizationListResponse,
  type OrganizationSettingsResponse,
  type OrganizationSummary,
  type OrganizationUserResponse,
  type OrganizationUserListRow,
  type ProjectListResponse,
  type ProjectOverviewSummary,
  type ProjectResponse,
  type ProjectShowResponse,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowResponse,
  type ResourceBackupSummary,
  type ResourceDeleteResponse,
  type ResourceLogLine,
  type ResourceLogsResponse,
  type ResourceRestoreAsResponse,
  type ResourceRestoreResponse,
  type ResourceListResponse,
  type ResourceResponse,
  type RemoveUserResponse,
  type RemoveVariableResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderSummary,
  type UserListResponse,
  type VariableGroupBindingResponse,
  type VariableGroupListResponse,
  type VariableGroupResponse,
  type VariableGroupUsage,
  type VariableGroupUsagesResponse,
  type VariableGroupVariable,
  type VariableDetail,
  type VariableListItem,
  type VariableListResponse,
  type VariableResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';
import {
  selfHostedUserSetupAppListeningLogText,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  removeLocalDockerImage,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';
import {
  buildSelfHostedAppHostname,
  configureSelfHostedTrustedOutboundHosts,
  describeSelfHostedUserSetupE2e,
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import {
  expectAppBuildMessage,
  expectAppDirectFlag,
  expectAppDatabaseValue,
  expectAppEnvMessage,
  expectAppForbidden,
  expectAppLoginRejected,
  expectAppLogoutRevokesAppOnly,
  expectAppRouteNotFound,
  expectAppSessionRedirectedToLogin,
  expectAppWhoAmI,
  expectControlPlaneLogoutRevokesApp,
  expectTrustedAppIngress,
  readAppBrowserSessionsWithRetry,
  readAppSessionCookieWithRetry,
  writeAppDatabaseValue,
} from './self-hosted-user-setup-app-probe.harness';
import type { SelfHostedUserSetupBrowserSessions } from './self-hosted-user-setup-http.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  expectAuditEvents,
  readAuditExportEventTypes,
  requireActivationToken,
  requireDeploymentRuntimeImageRef,
  requireRouteUrl,
  requireSingleActiveDeployment,
  requireSingleInspectedActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import {
  expectBlockedPublicControlPlanePaths,
  expectExplicitProjectLifecycleFlow,
  requireDetachedDeploymentRunId,
  waitForDeploymentRuntimeLog,
  waitForDeploymentRunCompletion,
  waitForRunningResource,
} from './self-hosted-user-setup-deployment-flow.harness';
import { expectAuditFileExports, expectAuditFileSinkCoverage } from './self-hosted-user-setup-audit-flow.harness';
import { expectCompartmentSkillInstallOnboarding } from './self-hosted-user-setup-agent-onboarding.harness';
import { expectCurrentOrganizationSlug } from './cli-response-test.harness';
import { cliRemoteListResponseSchema, cliRemoteResponseSchema } from './remote-command-response.harness';
import { expectK3dWorkerNamespaceIsolation, isK3dPlatformMode } from './self-hosted-user-setup-k3d.harness';
import {
  expectedAuditEventTypes,
  organizationUseResponseSchema,
  requireProjectOverview,
  requireSsoProvider,
  type OrganizationUseResponse,
} from './system-user-flow-response.harness';

const viewerEmail: string = 'viewer-self-hosted-e2e@example.com';
const viewerPassword: string = 'ViewerPassw0rd!';
const appMessage: string = 'hello-from-self-hosted-e2e';
const appBuildMessage: string = 'build-from-self-hosted-e2e';
const rollbackMessage: string = 'hello-before-rollback';
const rollbackBuildMessage: string = 'build-before-rollback';
const explicitProjectName: string = 'self-hosted-e2e-explicit';
const renamedProjectName: string = 'self-hosted-e2e-app-renamed';
const directFlagValue: string = 'direct-from-variable-set';
const beforeBackupValue: string = 'before-backup';
const afterBackupValue: string = 'after-backup';
const restoredResourceName: string = 'postgres-copy';
const appListeningLogText: string = selfHostedUserSetupAppListeningLogText;
const oidcIssuerHost: string = 'issuer.self-hosted-e2e.example.com';
const oidcIssuerUrl: string = `https://${oidcIssuerHost}`;
const permissionDeniedMessage: string = 'The current principal is not allowed to perform this operation.';
const noConfiguredLoginMessage: string = 'No Compartment login is configured.';
const loggedOutRemoteMessage: string = 'You are not logged in for remote';
const validSessionRequiredMessage: string = 'A valid session is required.';
const invalidRollbackRetentionMessage: string =
  'rollback retention must be inherit, indefinite, or a positive integer.';
const missingVariableGroupMessage: string = 'The requested variable group was not found in the current organization.';
const missingServiceMessage: string = 'The requested service was not found.';
const missingResourceBackupMessage: string = 'The requested resource backup was not found.';
const archivedProjectMessage: string = 'The requested project is archived.';
describeSelfHostedUserSetupE2e('self-hosted system user flow end-to-end', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  let runtime: SelfHostedUserSetupRuntime;
  let app: SelfHostedUserSetupAppFixture;
  let admin: SelfHostedUserSetupCli;
  let viewer: SelfHostedUserSetupCli;
  let routeUrl: string;
  let activeDeployment: DeploymentReadSummary;
  let rollbackTargetRuntimeImageRef: string;
  let adminAppSessionCookie: string;
  let backupId: string;
  let promotedDeploymentId: string;
  let completedCaseCount: number = 0;

  it(
    'case 1/8: installs the single-server system and logs in from a fresh CLI',
    async (): Promise<void> => {
      runtime = await setup.install();
      app = await setup.createAppFixture();
      admin = await setup.createFreshCli();
      viewer = await setup.createFreshCli();

      await expectBlockedPublicControlPlanePaths(runtime.compartmentUrl);
      if (isK3dPlatformMode()) {
        await expectK3dWorkerNamespaceIsolation();
      }

      const adminBeforeLogin: SelfHostedUserSetupCommandResult = await admin.runFailure('whoami --output json');
      expect(adminBeforeLogin.stderr).toContain(noConfiguredLoginMessage);

      const viewerBeforeLogin: SelfHostedUserSetupCommandResult = await viewer.runFailure('whoami --output json');
      expect(viewerBeforeLogin.stderr).toContain(noConfiguredLoginMessage);

      await admin.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
        {
          email: runtime.adminEmail,
          password: runtime.adminPassword,
        },
        { requestOrigin: runtime.apiUrl },
      );

      const identity: WhoAmICommandResponse = await admin.runJson('whoami', whoamiCommandResponseSchema);
      expect(identity.apiUrl).toBe(runtime.apiUrl);
      expect(identity.principal.email).toBe(runtime.adminEmail);
      expectCurrentOrganizationSlug(identity, runtime.organizationSlug);

      const remoteListPayload: CliRemoteListResponse = await admin.runJson('remote list', cliRemoteListResponseSchema);
      const remoteName: string = remoteListPayload.currentRemote ?? 'default';
      expect(remoteListPayload.remotes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            apiUrl: runtime.apiUrl,
            name: remoteName,
          } satisfies Partial<CliRemoteSummary>),
        ]),
      );

      const selectedRemotePayload: CliRemoteResponse = await admin.runJson(
        `remote use ${remoteName}`,
        cliRemoteResponseSchema,
        { cwd: app.directory },
      );
      expect(selectedRemotePayload.remote.apiUrl).toBe(runtime.apiUrl);
      expect(selectedRemotePayload.remote.currentOrganization?.slug).toBe(runtime.organizationSlug);

      const organizationListPayload: OrganizationListResponse = await admin.runJson(
        'org list',
        organizationListResponseSchema,
      );
      expect(
        organizationListPayload.organizations.map((organization: OrganizationSummary): string => organization.slug),
      ).toContain(runtime.organizationSlug);

      const logoutPayload: LogoutResponse = await admin.runJson('logout', logoutResponseSchema);
      expect(logoutPayload.success).toBe(true);

      const adminAfterLogout: SelfHostedUserSetupCommandResult = await admin.runFailure('whoami --output json');
      expect(adminAfterLogout.stderr).toContain(loggedOutRemoteMessage);

      await admin.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
        {
          email: runtime.adminEmail,
          password: runtime.adminPassword,
        },
        { requestOrigin: runtime.apiUrl },
      );

      const identityAfterRelogin: WhoAmICommandResponse = await admin.runJson('whoami', whoamiCommandResponseSchema);
      expect(identityAfterRelogin.principal.email).toBe(runtime.adminEmail);
      expectCurrentOrganizationSlug(identityAfterRelogin, runtime.organizationSlug);

      const createdOrganizationPayload: CreateOrganizationResponse = await admin.runJson(
        'org create --name "SelfHosted E2E Secondary" --slug self-hosted-e2e-secondary',
        createOrganizationResponseSchema,
      );
      expect(createdOrganizationPayload.organization.slug).toBe('self-hosted-e2e-secondary');

      const restoredOrganizationPayload: OrganizationUseResponse = await admin.runJson(
        `org use ${runtime.organizationSlug}`,
        organizationUseResponseSchema,
      );
      expect(restoredOrganizationPayload.organization.slug).toBe(runtime.organizationSlug);

      const sourceListPayload: GitSourceListResponse = await admin.runJson('source list', gitSourceListResponseSchema);
      expect(sourceListPayload.sources).toEqual([]);
      completedCaseCount = 1;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 2/8: configures auth and organization settings through the CLI',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 1);
      const authSettings: OrganizationAuthSettingsResponse = await admin.runJson(
        'auth settings get',
        organizationAuthSettingsResponseSchema,
      );
      expect(typeof authSettings.settings.localPasswordEnabled).toBe('boolean');

      const updatedAuthSettings: OrganizationAuthSettingsResponse = await admin.runJson(
        'auth settings set --password enabled',
        organizationAuthSettingsResponseSchema,
      );
      expect(updatedAuthSettings.settings.localPasswordEnabled).toBe(true);

      const persistedAuthSettings: OrganizationAuthSettingsResponse = await admin.runJson(
        'auth settings get',
        organizationAuthSettingsResponseSchema,
      );
      expect(persistedAuthSettings.settings.localPasswordEnabled).toBe(true);

      const organizationSettings: OrganizationSettingsResponse = await admin.runJson(
        'org settings get',
        organizationSettingsResponseSchema,
      );
      expect(organizationSettings.settings.auditRetention.effective.mode).toBeDefined();
      expect(organizationSettings.settings.rollbackRetention.effective.mode).toBeDefined();

      const updatedOrganizationSettings: OrganizationSettingsResponse = await admin.runJson(
        'org settings set --rollback-retention 3 --audit-retention 30',
        organizationSettingsResponseSchema,
      );
      expect(updatedOrganizationSettings.settings.auditRetention.configured).toEqual({
        days: 30,
        mode: 'keep_days',
      });
      expect(updatedOrganizationSettings.settings.rollbackRetention.configured).toEqual({
        limit: 3,
        mode: 'keep_last',
      });

      const persistedOrganizationSettings: OrganizationSettingsResponse = await admin.runJson(
        'org settings get',
        organizationSettingsResponseSchema,
      );
      expect(persistedOrganizationSettings.settings.auditRetention.configured).toEqual({
        days: 30,
        mode: 'keep_days',
      });
      expect(persistedOrganizationSettings.settings.rollbackRetention.configured).toEqual({
        limit: 3,
        mode: 'keep_last',
      });

      const invalidRollbackRetention: SelfHostedUserSetupCommandResult = await admin.runFailure(
        'org settings set --rollback-retention 0 --output json',
      );
      expect(invalidRollbackRetention.stderr).toContain(invalidRollbackRetentionMessage);

      const settingsAfterInvalidWrite: OrganizationSettingsResponse = await admin.runJson(
        'org settings get',
        organizationSettingsResponseSchema,
      );
      expect(settingsAfterInvalidWrite.settings.rollbackRetention.configured).toEqual({
        limit: 3,
        mode: 'keep_last',
      });

      const initialSsoProviders: SsoOidcProviderListResponse = await admin.runJson(
        'sso oidc list',
        ssoOidcProviderListResponseSchema,
      );
      expect(
        initialSsoProviders.providers.some(
          (provider: SsoOidcProviderSummary): boolean => provider.key === 'self-hosted-e2e-oidc',
        ),
      ).toBe(false);

      const untrustedOidcProvider: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `sso oidc add --key self-hosted-e2e-untrusted-oidc --client-id self-hosted-e2e-client --client-secret self-hosted-e2e-secret --issuer-url ${oidcIssuerUrl} --display-name "Untrusted E2E OIDC" --output json`,
      );
      expect(untrustedOidcProvider.stderr).toContain(
        `OIDC issuer host ${oidcIssuerHost} must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS.`,
      );

      await configureSelfHostedTrustedOutboundHosts([oidcIssuerHost]);

      const createdSsoProvider: SsoOidcProviderSummary = requireSsoProvider(
        await admin.runJson(
          `sso oidc add --key self-hosted-e2e-oidc --client-id self-hosted-e2e-client --client-secret self-hosted-e2e-secret --issuer-url ${oidcIssuerUrl} --display-name "SelfHosted E2E OIDC" --button-text "Sign in with E2E" --email-claims id-token:email --email-verified-claims id-token:email_verified=true --auto-join disabled`,
          ssoOidcProviderResponseSchema,
        ),
      );
      expect(createdSsoProvider).toEqual(
        expect.objectContaining({
          buttonText: 'Sign in with E2E',
          clientId: 'self-hosted-e2e-client',
          displayName: 'SelfHosted E2E OIDC',
          issuerUrl: oidcIssuerUrl,
          key: 'self-hosted-e2e-oidc',
          preset: 'generic',
        } satisfies Partial<SsoOidcProviderSummary>),
      );

      const ssoProvidersAfterCreate: SsoOidcProviderListResponse = await admin.runJson(
        'sso oidc list',
        ssoOidcProviderListResponseSchema,
      );
      expect(
        ssoProvidersAfterCreate.providers.some(
          (provider: SsoOidcProviderSummary): boolean => provider.id === createdSsoProvider.id,
        ),
      ).toBe(true);

      const updatedSsoProvider: SsoOidcProviderSummary = requireSsoProvider(
        await admin.runJson(
          `sso oidc update ${createdSsoProvider.id} --button-text "Use E2E OIDC" --scope "openid email" --verified-email-claims userinfo:email --auto-join enabled --auto-join-domains example.com,self-hosted-e2e.example.com --auto-join-role readonly`,
          ssoOidcProviderResponseSchema,
        ),
      );
      expect(updatedSsoProvider.id).toBe(createdSsoProvider.id);
      expect(updatedSsoProvider.buttonText).toBe('Use E2E OIDC');
      expect(updatedSsoProvider.scope).toBe('openid email');
      expect(updatedSsoProvider.identityVerification.verifiedEmailClaims).toEqual([
        {
          claim: 'email',
          source: 'userinfo',
        },
      ]);
      expect(updatedSsoProvider.provisioning).toEqual({
        allowedEmailDomains: ['example.com', 'self-hosted-e2e.example.com'],
        autoJoinEnabled: true,
        defaultRole: 'readonly',
      });

      const removedSsoProvider: DeleteSsoOidcProviderResponse = await admin.runJson(
        `sso oidc remove ${createdSsoProvider.id}`,
        deleteSsoOidcProviderResponseSchema,
      );
      expect(removedSsoProvider.success).toBe(true);

      const ssoProvidersAfterRemove: SsoOidcProviderListResponse = await admin.runJson(
        'sso oidc list',
        ssoOidcProviderListResponseSchema,
      );
      expect(
        ssoProvidersAfterRemove.providers.some(
          (provider: SsoOidcProviderSummary): boolean => provider.id === createdSsoProvider.id,
        ),
      ).toBe(false);
      completedCaseCount = 2;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 3/8: deploys an app with variable groups, generated resource env, and descriptor resource-output env',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 2);
      const initialVariableGroups: VariableGroupListResponse = await admin.runJson(
        'variable group list',
        variableGroupListResponseSchema,
      );
      expect(initialVariableGroups.variableGroups).toEqual([]);

      const createdGroup: VariableGroupResponse = await admin.runJson(
        `variable group create ${app.variableGroupName}`,
        variableGroupResponseSchema,
      );
      expect(createdGroup.variableGroup.name).toBe(app.variableGroupName);

      const groupsAfterCreate: VariableGroupListResponse = await admin.runJson(
        'variable group list',
        variableGroupListResponseSchema,
      );
      expect(groupsAfterCreate.variableGroups).toEqual([
        expect.objectContaining({
          name: app.variableGroupName,
          variableCount: 0,
        }),
      ]);

      const messageGroup: VariableGroupResponse = await admin.runJson(
        `variable group put ${app.variableGroupName} E2E_MESSAGE ${appMessage}`,
        variableGroupResponseSchema,
      );
      expect(messageGroup.variableGroup.variables).toEqual([
        expect.objectContaining({
          keyName: 'E2E_MESSAGE',
          sensitivity: 'plain',
        } satisfies Partial<VariableGroupVariable>),
      ]);

      const shownGroup: VariableGroupResponse = await admin.runJson(
        `variable group show ${app.variableGroupName}`,
        variableGroupResponseSchema,
      );
      expect(shownGroup.variableGroup.variables).toEqual([
        expect.objectContaining({
          keyName: 'E2E_MESSAGE',
          sensitivity: 'plain',
        } satisfies Partial<VariableGroupVariable>),
      ]);

      const binding: VariableGroupBindingResponse = await admin.runJson(
        `variable bind ${app.variableGroupName} --env ${app.environmentName}`,
        variableGroupBindingResponseSchema,
        { cwd: app.directory },
      );
      expect(binding.variableGroupName).toBe(app.variableGroupName);

      const variableGroupUsages: VariableGroupUsagesResponse = await admin.runJson(
        `variable group usages ${app.variableGroupName}`,
        variableGroupUsagesResponseSchema,
      );
      expect(variableGroupUsages.usages).toEqual([
        expect.objectContaining({
          environmentName: app.environmentName,
          projectName: app.projectName,
          resourceName: null,
          serviceName: null,
        } satisfies Partial<VariableGroupUsage>),
      ]);

      const directVariablePayload: VariableResponse = await admin.runJson(
        `variable set DIRECT_FLAG ${directFlagValue} --env ${app.environmentName}`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      expect(directVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'DIRECT_FLAG',
          sensitivity: 'plain',
          sourceType: 'direct',
          value: directFlagValue,
          valueHidden: false,
        } satisfies Partial<VariableDetail>),
      );

      const buildVariablePayload: VariableResponse = await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${appBuildMessage} --env ${app.environmentName}`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      expect(buildVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'E2E_BUILD_MESSAGE',
          sensitivity: 'plain',
          sourceType: 'direct',
          value: appBuildMessage,
          valueHidden: false,
        } satisfies Partial<VariableDetail>),
      );

      const importedVariablePayload: ImportVariablesResponse = await admin.runJson(
        `variable import --file ${app.importedVariableFileName} --env ${app.environmentName}`,
        importVariablesResponseSchema,
        { cwd: app.directory },
      );
      expect(importedVariablePayload.importedKeyNames).toEqual(['IMPORTED_FLAG']);

      const removedImportedVariablePayload: RemoveVariableResponse = await admin.runJson(
        `variable remove IMPORTED_FLAG --env ${app.environmentName}`,
        removeVariableResponseSchema,
        { cwd: app.directory },
      );
      expect(removedImportedVariablePayload.success).toBe(true);

      await admin.runJson('variable group create self-hosted-e2e-imported', variableGroupResponseSchema);
      const importedGroupPayload: ImportVariableGroupResponse = await admin.runJson(
        `variable group import self-hosted-e2e-imported --file ${app.importedGroupFileName}`,
        importVariableGroupResponseSchema,
        { cwd: app.directory },
      );
      expect(importedGroupPayload.importedKeyNames).toEqual(['IMPORTED_GROUP_FLAG']);

      const capturedGroupPayload: CaptureVariableGroupResponse = await admin.runJson(
        `variable group capture self-hosted-e2e-captured --env ${app.environmentName}`,
        captureVariableGroupResponseSchema,
        { cwd: app.directory },
      );
      expect(capturedGroupPayload.capturedKeyNames).toEqual(['DIRECT_FLAG', 'E2E_BUILD_MESSAGE']);

      const missingGroupUsage: SelfHostedUserSetupCommandResult = await admin.runFailure(
        'variable group usages missing-self-hosted-e2e-group --output json',
      );
      expect(missingGroupUsage.stderr).toContain(missingVariableGroupMessage);

      const localProject: ProjectShowResponse = await admin.runJson('project show', projectShowResponseSchema, {
        cwd: app.directory,
      });
      expect(localProject.localProjectName).toBe(app.projectName);
      expect(localProject.descriptorFile).toContain(app.directory);

      await expectCompartmentSkillInstallOnboarding(admin, app.directory);

      const missingServiceVariable: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `variable set SERVICE_FLAG enabled --service ${app.serviceName} --output json`,
        { cwd: app.directory },
      );
      expect(missingServiceVariable.stderr).toContain(missingServiceMessage);

      const databaseUrlBindingPayload: VariableResponse = await admin.runJson(
        `variable set DATABASE_URL --service ${app.serviceName} --from-resource ${app.resourceName}.connection-url`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      expect(databaseUrlBindingPayload.serviceName).toBe(app.serviceName);
      expect(databaseUrlBindingPayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'DATABASE_URL',
          scopeServiceName: app.serviceName,
          scopeType: 'service',
          sourceResourceOutput: `${app.resourceName}.connection-url`,
          sourceType: 'resource_output',
          valueHidden: true,
        } satisfies Partial<VariableDetail>),
      );

      const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy',
        deployCommandResponseParser,
        {
          cwd: app.directory,
        },
      );
      expect(requireSingleActiveDeployment(deployPayload, app.serviceName).status).toBe('succeeded');
      expect(deployPayload.resources).toEqual([
        expect.objectContaining({
          name: app.resourceName,
        }),
      ]);

      if (isK3dPlatformMode()) {
        const bootstrapPayload: ResourceResponse = await admin.runJson(
          `resource bootstrap --project ${app.projectName} --resource ${app.resourceName}`,
          resourceResponseSchema,
        );
        expect(bootstrapPayload.resource.name).toBe(app.resourceName);
      }
      await waitForRunningResource(admin, app.projectName, app.resourceName);
      const statusPayload: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      routeUrl = requireRouteUrl(statusPayload, app.serviceName);
      activeDeployment = requireSingleActiveDeployment(statusPayload, app.serviceName);
      let adminBrowserSessions: SelfHostedUserSetupBrowserSessions = await readAppBrowserSessionsWithRetry(routeUrl, {
        email: runtime.adminEmail,
        password: runtime.adminPassword,
      });
      adminAppSessionCookie = adminBrowserSessions.appSessionCookie;
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);
      await expectAppDirectFlag(routeUrl, adminAppSessionCookie, directFlagValue);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);
      await expectTrustedAppIngress(routeUrl, adminAppSessionCookie, runtime.adminEmail, runtime.organizationSlug);
      await expectAppLogoutRevokesAppOnly(runtime.compartmentUrl, routeUrl, adminBrowserSessions, runtime.adminEmail);

      adminBrowserSessions = await readAppBrowserSessionsWithRetry(routeUrl, {
        email: runtime.adminEmail,
        password: runtime.adminPassword,
      });
      await expectControlPlaneLogoutRevokesApp(runtime.compartmentUrl, routeUrl, adminBrowserSessions);

      adminAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
        email: runtime.adminEmail,
        password: runtime.adminPassword,
      });
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);

      const serviceVariablePayload: VariableResponse = await admin.runJson(
        `variable set SERVICE_FLAG enabled --service ${app.serviceName}`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      expect(serviceVariablePayload.serviceName).toBe(app.serviceName);
      expect(serviceVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'SERVICE_FLAG',
          scopeServiceName: app.serviceName,
          scopeType: 'service',
          value: 'enabled',
          valueHidden: false,
        } satisfies Partial<VariableDetail>),
      );

      const serviceImportPayload: ImportVariablesResponse = await admin.runJson(
        `variable import --file ${app.importedVariableFileName} --service ${app.serviceName}`,
        importVariablesResponseSchema,
        { cwd: app.directory },
      );
      expect(serviceImportPayload.importedKeyNames).toEqual(['IMPORTED_FLAG']);
      expect(serviceImportPayload.serviceName).toBe(app.serviceName);

      const serviceVariableList: VariableListResponse = await admin.runJson(
        `variable list --service ${app.serviceName}`,
        variableListResponseSchema,
        { cwd: app.directory },
      );
      expect(serviceVariableList.variables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keyName: 'SERVICE_FLAG',
            scopeServiceName: app.serviceName,
            scopeType: 'service',
          } satisfies Partial<VariableListItem>),
          expect.objectContaining({
            keyName: 'IMPORTED_FLAG',
            scopeServiceName: app.serviceName,
            scopeType: 'service',
          } satisfies Partial<VariableListItem>),
        ]),
      );

      const descriptorPath: string = join(app.directory, 'compartment.yml');
      const originalDescriptorContents: string = await readFile(descriptorPath, 'utf8');
      try {
        await writeFile(descriptorPath, `name: ${app.projectName}\n\nservices:\n  renamed: .\n`, 'utf8');
        const staleDescriptorVariablePayload: VariableResponse = await admin.runJson(
          `variable set STALE_DESCRIPTOR_FLAG after-rename --service ${app.serviceName}`,
          variableResponseSchema,
          { cwd: app.directory },
        );
        expect(staleDescriptorVariablePayload.serviceName).toBe(app.serviceName);
        expect(staleDescriptorVariablePayload.variable.scopeType).toBe('service');
      } finally {
        await writeFile(descriptorPath, originalDescriptorContents, 'utf8');
      }
      completedCaseCount = 3;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 4/8: checks deployment status, lists, inspect, and runtime logs',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 3);
      const variableListPayload: VariableListResponse = await admin.runJson(
        `variable list --project ${app.projectName} --env ${app.environmentName} --service ${app.serviceName}`,
        variableListResponseSchema,
      );
      expect(variableListPayload.variables.map((variable: VariableListItem): string => variable.keyName)).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'DIRECT_FLAG', 'E2E_MESSAGE']),
      );

      const messageVariablePayload: VariableResponse = await admin.runJson(
        `variable show E2E_MESSAGE --project ${app.projectName} --env ${app.environmentName} --service ${app.serviceName}`,
        variableResponseSchema,
      );
      expect(messageVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'E2E_MESSAGE',
          sensitivity: 'plain',
          sourceType: 'set',
          sourceVariableSetName: app.variableGroupName,
          value: appMessage,
          valueHidden: false,
        } satisfies Partial<VariableDetail>),
      );

      const databaseVariablePayload: VariableResponse = await admin.runJson(
        `variable show DATABASE_URL --project ${app.projectName} --env ${app.environmentName} --service ${app.serviceName}`,
        variableResponseSchema,
      );
      expect(databaseVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'DATABASE_URL',
          sensitivity: 'sensitive',
          sourceResourceOutput: `${app.resourceName}.connection-url`,
          sourceType: 'resource_output',
          sourceVariableSetName: null,
          valueHidden: true,
        } satisfies Partial<VariableDetail>),
      );

      const directVariablePayload: VariableResponse = await admin.runJson(
        `variable show DIRECT_FLAG --project ${app.projectName} --env ${app.environmentName}`,
        variableResponseSchema,
      );
      expect(directVariablePayload.variable).toEqual(
        expect.objectContaining({
          keyName: 'DIRECT_FLAG',
          sensitivity: 'plain',
          sourceType: 'direct',
          value: directFlagValue,
          valueHidden: false,
        } satisfies Partial<VariableDetail>),
      );

      const directVariableRun: SelfHostedUserSetupCommandResult = await admin.run(
        `variable run --project ${app.projectName} --env ${app.environmentName} --service ${app.serviceName} --allow-production -- node -e "process.stdout.write(process.env.DIRECT_FLAG ?? '')"`,
      );
      expect(directVariableRun.stdout).toBe(directFlagValue);

      const projectListPayload: ProjectListResponse = await admin.runJson(
        'project list --full',
        projectListResponseSchema,
      );
      const listedProject: ProjectOverviewSummary = requireProjectOverview(projectListPayload, app.projectName);
      expect(listedProject.routeUrl).toBe(routeUrl);
      expect(listedProject.serviceCount).toBe(1);
      expect(listedProject.status).toBe('healthy');

      const deploymentListPayload: DeploymentListResponse = await admin.runJson(
        `deployment list --project ${app.projectName} --limit 10`,
        deploymentListResponseSchema,
      );
      expect(
        deploymentListPayload.deployments.some(
          (deployment: DeploymentReadSummary): boolean => deployment.id === activeDeployment.id,
        ),
      ).toBe(true);

      const deploymentRunLogs: DeploymentRunLogsResponse = await admin.runJson(
        `deployment logs --project ${app.projectName} --run ${activeDeployment.deploymentRunId}`,
        deploymentRunLogsResponseSchema,
      );
      expect(deploymentRunLogs.deployment.id).toBe(activeDeployment.deploymentRunId);
      expect(
        deploymentRunLogs.steps.some(
          (step: DeploymentRunStepSummary): boolean => step.stepKey === 'completed' && step.status === 'succeeded',
        ),
      ).toBe(true);
      expect(deploymentRunLogs.lines.some((line: DeploymentRunLogLine): boolean => line.stepKey === 'completed')).toBe(
        true,
      );

      const inspectPayload: DeploymentInspectResponse = await admin.runJson(
        `inspect --project ${app.projectName}`,
        deploymentInspectResponseSchema,
      );
      const inspectedDeployment: DeploymentInspectTarget = requireSingleInspectedActiveDeployment(
        inspectPayload,
        app.serviceName,
      );
      expect(inspectPayload.sensitiveTopologyVisible).toBe(true);
      expect(inspectedDeployment.id).toBe(activeDeployment.id);
      expect(inspectedDeployment.runtime).not.toBeNull();

      await waitForDeploymentRuntimeLog(admin, app.projectName, app.serviceName, appListeningLogText);

      const detachedDeploy: SelfHostedUserSetupCommandResult = await admin.run('deploy --detach', {
        cwd: app.directory,
      });
      const detachedDeploymentRunId: string = requireDetachedDeploymentRunId(detachedDeploy.stdout);
      const detachedRunLogs: DeploymentRunLogsResponse = await waitForDeploymentRunCompletion(
        admin,
        app.projectName,
        detachedDeploymentRunId,
      );
      expect(detachedRunLogs.deployment.id).toBe(detachedDeploymentRunId);

      const detachedStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      activeDeployment = requireSingleActiveDeployment(detachedStatus, app.serviceName);
      expect(activeDeployment.deploymentRunId).toBe(detachedDeploymentRunId);

      const rollbackTargetInspectPayload: DeploymentInspectResponse = await admin.runJson(
        `inspect --project ${app.projectName}`,
        deploymentInspectResponseSchema,
      );
      const rollbackTargetDeployment: DeploymentInspectTarget = requireSingleInspectedActiveDeployment(
        rollbackTargetInspectPayload,
        app.serviceName,
      );
      expect(rollbackTargetDeployment.id).toBe(activeDeployment.id);
      rollbackTargetRuntimeImageRef = requireDeploymentRuntimeImageRef(rollbackTargetDeployment);

      await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${appBuildMessage} --project ${explicitProjectName} --env ${app.environmentName}`,
        variableResponseSchema,
      );

      const explicitDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        `deploy --project ${explicitProjectName}`,
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      const explicitRouteUrl: string = requireRouteUrl(explicitDeployPayload, app.serviceName);
      expect(explicitDeployPayload.project.name).toBe(explicitProjectName);
      expect(new URL(explicitRouteUrl).hostname).toBe(buildSelfHostedAppHostname(runtime, explicitProjectName));

      const explicitStatusPayload: DeploymentStatusResponse = await admin.runJson(
        `status --project ${explicitProjectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireRouteUrl(explicitStatusPayload, app.serviceName)).toBe(explicitRouteUrl);

      await waitForDeploymentRuntimeLog(admin, explicitProjectName, app.serviceName, appListeningLogText);

      await expectExplicitProjectLifecycleFlow(admin, explicitProjectName, app.serviceName, explicitRouteUrl);
      completedCaseCount = 4;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 5/8: backs up and restores the app database resource',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 4);
      const resourcesPayload: ResourceListResponse = await admin.runJson(
        `resource list --project ${app.projectName}`,
        resourceListResponseSchema,
      );
      expect(resourcesPayload.resources).toEqual([
        expect.objectContaining({
          name: app.resourceName,
          status: 'running',
        }),
      ]);

      const resourcePayload: ResourceResponse = await admin.runJson(
        `resource inspect --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(resourcePayload.resource.status).toBe('running');

      const resourceLogsPayload: ResourceLogsResponse = await admin.runJson(
        `resource logs --project ${app.projectName} --resource ${app.resourceName} --tail 50`,
        resourceLogsResponseSchema,
      );
      expect(resourceLogsPayload.resource.name).toBe(app.resourceName);
      expect(
        resourceLogsPayload.lines.every((line: ResourceLogLine): boolean => line.resourceName === app.resourceName),
      ).toBe(true);

      const stoppedResourcePayload: ResourceResponse = await admin.runJson(
        `resource stop --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(stoppedResourcePayload.resource.status).toBe('stopped');

      const startedResourcePayload: ResourceResponse = await admin.runJson(
        `resource start --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(startedResourcePayload.resource.status).toBe('running');

      const missingBackup: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `resource backup show --project ${app.projectName} --backup rbak_missing --output json`,
      );
      expect(missingBackup.stderr).toContain(missingResourceBackupMessage);

      await writeAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue, true);

      const backupPayload: ResourceBackupCreateResponse = await admin.runJson(
        `resource backup create --project ${app.projectName} --resource ${app.resourceName}`,
        resourceBackupCreateResponseSchema,
      );
      expect(backupPayload.backup.status).toBe('succeeded');
      backupId = backupPayload.backup.id;

      const backupShowPayload: ResourceBackupShowResponse = await admin.runJson(
        `resource backup show --project ${app.projectName} --backup ${backupId}`,
        resourceBackupShowResponseSchema,
      );
      expect(backupShowPayload.backup.id).toBe(backupId);

      const backupListPayload: ResourceBackupListResponse = await admin.runJson(
        `resource backup list --project ${app.projectName} --resource ${app.resourceName}`,
        resourceBackupListResponseSchema,
      );
      expect(backupListPayload.backups.some((backup: ResourceBackupSummary): boolean => backup.id === backupId)).toBe(
        true,
      );

      await writeAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue, true);

      const restorePayload: ResourceRestoreResponse = await admin.runJson(
        `resource backup restore --project ${app.projectName} --resource ${app.resourceName} --backup ${backupId} --yes`,
        resourceRestoreResponseSchema,
      );
      expect(restorePayload.success).toBe(true);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue, true);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue, false);
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);

      const restoreAsPayload: ResourceRestoreAsResponse = await admin.runJson(
        `resource backup restore --project ${app.projectName} --backup ${backupId} --as ${restoredResourceName}`,
        resourceRestoreAsResponseSchema,
      );
      expect(restoreAsPayload.success).toBe(true);
      expect(restoreAsPayload.resource.name).toBe(restoredResourceName);
      expect(restoreAsPayload.resource.status).toBe('running');

      const deleteRestoredResourcePayload: ResourceDeleteResponse = await admin.runJson(
        `resource delete --project ${app.projectName} --resource ${restoredResourceName} --delete-data --yes`,
        resourceDeleteResponseSchema,
      );
      expect(deleteRestoredResourcePayload.success).toBe(true);
      expect(deleteRestoredResourcePayload.retainedVolumes).toEqual([]);
      completedCaseCount = 5;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 6/8: redeploys, rolls back, and promotes staging to production',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 5);
      await admin.runJson(
        `variable group put ${app.variableGroupName} E2E_MESSAGE ${rollbackMessage}`,
        variableGroupResponseSchema,
      );
      await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${rollbackBuildMessage} --env ${app.environmentName}`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${rollbackBuildMessage} --env staging`,
        variableResponseSchema,
        { cwd: app.directory },
      );

      const secondDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy',
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      const secondDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        secondDeployPayload,
        app.serviceName,
      );
      expect(secondDeployment.id).not.toBe(activeDeployment.id);
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, rollbackBuildMessage);

      if (!isK3dPlatformMode()) {
        await removeLocalDockerImage(rollbackTargetRuntimeImageRef);
      }

      const rollbackPayload: DeploymentStatusResponse = await admin.runJson(
        `rollback --project ${app.projectName}`,
        deploymentStatusResponseSchema,
      );
      const rolledBackDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        rollbackPayload,
        app.serviceName,
      );
      expect(rolledBackDeployment.id).not.toBe(secondDeployment.id);
      expect(rolledBackDeployment.status).toBe('succeeded');
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);

      const rollbackInspectPayload: DeploymentInspectResponse = await admin.runJson(
        `inspect --project ${app.projectName}`,
        deploymentInspectResponseSchema,
      );
      expect(
        requireDeploymentRuntimeImageRef(
          requireSingleInspectedActiveDeployment(rollbackInspectPayload, app.serviceName),
        ),
      ).toBe(rollbackTargetRuntimeImageRef);

      const stagingDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy --env staging',
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      const stagingDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        stagingDeployPayload,
        app.serviceName,
      );
      expect(stagingDeployment.status).toBe('succeeded');

      const promotedPayload: DeploymentStatusResponse = await admin.runJson(
        `promote --project ${app.projectName} --from staging --to production`,
        deploymentStatusResponseSchema,
      );
      const promotedDeployment: DeploymentReadSummary = requireSingleActiveDeployment(promotedPayload, app.serviceName);
      expect(promotedDeployment.id).not.toBe(stagingDeployment.id);
      expect(promotedDeployment.status).toBe('succeeded');
      promotedDeploymentId = promotedDeployment.id;

      const productionStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName} --env production`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireSingleActiveDeployment(productionStatus, app.serviceName).id).toBe(promotedDeployment.id);

      const stagingStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName} --env staging`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireSingleActiveDeployment(stagingStatus, app.serviceName).id).toBe(stagingDeployment.id);

      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      completedCaseCount = 6;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 7/8: invites a user, grants app access, and keeps writes denied',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 6);
      const invitePayload: InviteUserResponse = await admin.runJson(
        `user invite ${viewerEmail}`,
        inviteUserResponseSchema,
      );
      const activationToken: string = requireActivationToken(invitePayload);

      const activationPayload: ActivateResponse = await viewer.runJson(
        `activate --api-url ${runtime.apiUrl} --email ${viewerEmail} --token ${activationToken}`,
        activateResponseSchema,
        {
          input: `${viewerPassword}\n${viewerPassword}\n`,
        },
      );
      expect(activationPayload.principal.email).toBe(viewerEmail);

      const viewerIdentity: WhoAmICommandResponse = await viewer.runJson('whoami', whoamiCommandResponseSchema);
      expect(viewerIdentity.principal.email).toBe(viewerEmail);
      expectCurrentOrganizationSlug(viewerIdentity, runtime.organizationSlug);

      const deniedViewerStatusBeforeGrant: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusBeforeGrant.stderr).toContain(permissionDeniedMessage);

      await expectAppLoginRejected(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      let viewerAppSessionCookie: string;

      const rolePayload: AccessRoleResponse = await admin.runJson(
        'role create self-hosted-e2e-app-reader --permission project.read deployment.read deployment.logs.read deployment.inspect app.route.access',
        accessRoleResponseSchema,
      );
      const shownRolePayload: AccessRoleResponse = await admin.runJson(
        `role show ${rolePayload.role.id}`,
        accessRoleResponseSchema,
      );
      expect(shownRolePayload.role.id).toBe(rolePayload.role.id);

      const updatedRolePayload: AccessRoleResponse = await admin.runJson(
        `role update ${rolePayload.role.id} --name self-hosted-e2e-app-reader-updated --permission project.read deployment.read deployment.logs.read deployment.inspect app.route.access`,
        accessRoleResponseSchema,
      );
      expect(updatedRolePayload.role.id).toBe(rolePayload.role.id);
      expect(updatedRolePayload.role.name).toBe('self-hosted-e2e-app-reader-updated');
      const updatedShownRolePayload: AccessRoleResponse = await admin.runJson(
        `role show ${rolePayload.role.id}`,
        accessRoleResponseSchema,
      );
      expect(updatedShownRolePayload.role.name).toBe('self-hosted-e2e-app-reader-updated');

      const roleListPayload: AccessRoleListResponse = await admin.runJson('role list', accessRoleListResponseSchema);
      expect(roleListPayload.roles.some((role: AccessRoleListRow): boolean => role.id === rolePayload.role.id)).toBe(
        true,
      );

      const groupPayload: AccessGroupResponse = await admin.runJson(
        'group create self-hosted-e2e-readers',
        accessGroupResponseSchema,
      );
      const groupMemberPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member add ${groupPayload.group.id} ${viewerEmail}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        groupMemberPayload.members.some((member: AccessGroupMemberSummary): boolean => member.email === viewerEmail),
      ).toBe(true);

      const groupMemberListPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member list ${groupPayload.group.id}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        groupMemberListPayload.members.some(
          (member: AccessGroupMemberSummary): boolean => member.email === viewerEmail,
        ),
      ).toBe(true);

      const groupListPayload: AccessGroupListResponse = await admin.runJson(
        'group list',
        accessGroupListResponseSchema,
      );
      expect(
        groupListPayload.groups.some((group: AccessGroupListRow): boolean => group.id === groupPayload.group.id),
      ).toBe(true);

      const assignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment create --role ${rolePayload.role.id} --scope project --project ${app.projectName} --group ${groupPayload.group.id}`,
        accessAssignmentResponseSchema,
      );
      expect(assignmentPayload.assignment.roleId).toBe(rolePayload.role.id);

      const assignmentListPayload: AccessAssignmentListResponse = await admin.runJson(
        'assignment list',
        accessAssignmentListResponseSchema,
      );
      expect(
        assignmentListPayload.assignments.some(
          (assignment: AccessAssignmentSummary): boolean => assignment.id === assignmentPayload.assignment.id,
        ),
      ).toBe(true);

      const userListPayload: UserListResponse = await admin.runJson('user list', userListResponseSchema);
      expect(userListPayload.users.map((user: OrganizationUserListRow): string => user.email)).toEqual(
        expect.arrayContaining([runtime.adminEmail, viewerEmail]),
      );

      const viewerStatusPayload: DeploymentStatusResponse = await viewer.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireRouteUrl(viewerStatusPayload, app.serviceName)).toBe(routeUrl);

      const viewerInspectPayload: DeploymentInspectResponse = await viewer.runJson(
        `inspect --project ${app.projectName}`,
        deploymentInspectResponseSchema,
      );
      expect(requireSingleInspectedActiveDeployment(viewerInspectPayload, app.serviceName).id).toBe(
        promotedDeploymentId,
      );

      const viewerRuntimeLogs: DeploymentLogsResponse = await viewer.runJson(
        `logs --project ${app.projectName}`,
        deploymentLogsResponseSchema,
      );
      expect(
        viewerRuntimeLogs.lines.some(
          (line: DeploymentLogLine): boolean =>
            line.serviceName === app.serviceName && line.message.includes(appListeningLogText),
        ),
      ).toBe(true);

      const deniedAuthSettingsWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'auth settings set --password disabled --output json',
      );
      expect(deniedAuthSettingsWrite.stderr).toContain(permissionDeniedMessage);

      const deniedVariableWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `variable group put ${app.variableGroupName} SHOULD_FAIL nope --output json`,
      );
      expect(deniedVariableWrite.stderr).toContain(permissionDeniedMessage);

      const deniedBackupWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `resource backup create --project ${app.projectName} --resource ${app.resourceName} --output json`,
      );
      expect(deniedBackupWrite.stderr).toContain(permissionDeniedMessage);
      viewerAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      await expectAppWhoAmI(routeUrl, viewerAppSessionCookie, viewerEmail, runtime.organizationSlug);

      const deniedStagingDeployBeforeGrant: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'deploy --env staging --output json',
        { cwd: app.directory },
      );
      expect(deniedStagingDeployBeforeGrant.stderr).toContain(permissionDeniedMessage);

      const deployerRolePayload: AccessRoleResponse = await admin.runJson(
        'role create self-hosted-e2e-staging-deployer --permission deployment.create deployment.read',
        accessRoleResponseSchema,
      );
      const deployerAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment create --role ${deployerRolePayload.role.id} --scope environment --project ${app.projectName} --environment staging --user ${viewerEmail}`,
        accessAssignmentResponseSchema,
      );
      expect(deployerAssignmentPayload.assignment.roleId).toBe(deployerRolePayload.role.id);

      const viewerStagingDeployPayload: SelfHostedDeployCommandResponse = await viewer.runJson(
        'deploy --env staging',
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      expect(viewerStagingDeployPayload.environment.name).toBe('staging');
      expect(requireSingleActiveDeployment(viewerStagingDeployPayload, app.serviceName).status).toBe('succeeded');

      const deniedProductionDeploy: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'deploy --env production --output json',
        { cwd: app.directory },
      );
      expect(deniedProductionDeploy.stderr).toContain(permissionDeniedMessage);

      const blockedViewerPayload: OrganizationUserResponse = await admin.runJson(
        `user block ${viewerEmail}`,
        organizationUserResponseSchema,
      );
      expect(blockedViewerPayload.user.access).toBe('blocked');

      const deniedViewerStatusAfterBlock: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusAfterBlock.stderr).toContain(validSessionRequiredMessage);
      await expectAppSessionRedirectedToLogin(
        runtime.compartmentUrl,
        routeUrl,
        viewerAppSessionCookie,
        '/probe/whoami',
      );

      const unblockedViewerPayload: OrganizationUserResponse = await admin.runJson(
        `user unblock ${viewerEmail}`,
        organizationUserResponseSchema,
      );
      expect(unblockedViewerPayload.user.access).toBe('allowed');

      await viewer.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${viewerEmail} --output json`,
        {
          email: viewerEmail,
          password: viewerPassword,
        },
        { requestOrigin: runtime.apiUrl },
      );
      const viewerIdentityAfterUnblock: WhoAmICommandResponse = await viewer.runJson(
        'whoami',
        whoamiCommandResponseSchema,
      );
      expect(viewerIdentityAfterUnblock.principal.email).toBe(viewerEmail);

      const viewerStatusAfterUnblock: DeploymentStatusResponse = await viewer.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireRouteUrl(viewerStatusAfterUnblock, app.serviceName)).toBe(routeUrl);
      viewerAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      await expectAppWhoAmI(routeUrl, viewerAppSessionCookie, viewerEmail, runtime.organizationSlug);

      const deletedAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment delete ${assignmentPayload.assignment.id}`,
        accessAssignmentResponseSchema,
      );
      expect(deletedAssignmentPayload.assignment.id).toBe(assignmentPayload.assignment.id);

      const deletedDeployerAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment delete ${deployerAssignmentPayload.assignment.id}`,
        accessAssignmentResponseSchema,
      );
      expect(deletedDeployerAssignmentPayload.assignment.id).toBe(deployerAssignmentPayload.assignment.id);

      const deniedViewerStatusAfterRevoke: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusAfterRevoke.stderr).toContain(permissionDeniedMessage);
      await expectAppForbidden(routeUrl, viewerAppSessionCookie, '/probe/whoami');

      const removedGroupMemberPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member remove ${groupPayload.group.id} ${viewerEmail}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        removedGroupMemberPayload.members.some(
          (member: AccessGroupMemberSummary): boolean => member.email === viewerEmail,
        ),
      ).toBe(false);

      const deletedGroupPayload: AccessGroupResponse = await admin.runJson(
        `group delete ${groupPayload.group.id} --yes`,
        accessGroupResponseSchema,
      );
      expect(deletedGroupPayload.group.id).toBe(groupPayload.group.id);

      const deletedRolePayload: AccessRoleResponse = await admin.runJson(
        `role delete ${rolePayload.role.id} --yes`,
        accessRoleResponseSchema,
      );
      expect(deletedRolePayload.role.id).toBe(rolePayload.role.id);

      const deletedDeployerRolePayload: AccessRoleResponse = await admin.runJson(
        `role delete ${deployerRolePayload.role.id} --yes`,
        accessRoleResponseSchema,
      );
      expect(deletedDeployerRolePayload.role.id).toBe(deployerRolePayload.role.id);

      const removedViewerPayload: RemoveUserResponse = await admin.runJson(
        `user remove ${viewerEmail} --yes`,
        removeUserResponseSchema,
      );
      expect(removedViewerPayload.success).toBe(true);

      const viewerAfterRemove: SelfHostedUserSetupCommandResult = await viewer.runFailure('whoami --output json');
      expect(viewerAfterRemove.stderr).not.toBe('');
      await expectAppSessionRedirectedToLogin(
        runtime.compartmentUrl,
        routeUrl,
        viewerAppSessionCookie,
        '/probe/whoami',
      );
      completedCaseCount = 7;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 8/8: exports audit events and archives/unarchives the project',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 7);
      const unboundGroupPayload: VariableGroupBindingResponse = await admin.runJson(
        `variable unbind ${app.variableGroupName} --env ${app.environmentName}`,
        variableGroupBindingResponseSchema,
        { cwd: app.directory },
      );
      expect(unboundGroupPayload.variableGroupName).toBe(app.variableGroupName);

      const variableGroupUsagesAfterUnbind: VariableGroupUsagesResponse = await admin.runJson(
        `variable group usages ${app.variableGroupName}`,
        variableGroupUsagesResponseSchema,
      );
      expect(variableGroupUsagesAfterUnbind.usages).toEqual([]);

      await expectAuditFileSinkCoverage(admin);

      const auditPayload: AuditEventListResponse = await admin.runJson(
        'audit list --per-page 50',
        auditEventListResponseSchema,
      );
      expectAuditEvents(auditPayload, [
        'organization.user.removed',
        'organization.group.deleted',
        'organization.role.deleted',
      ]);

      for (const eventType of expectedAuditEventTypes) {
        const filteredAuditPayload: AuditEventListResponse = await admin.runJson(
          `audit list --event ${eventType} --per-page 1`,
          auditEventListResponseSchema,
        );
        expectAuditEvents(filteredAuditPayload, [eventType]);
      }

      const auditExport: SelfHostedUserSetupCommandResult = await admin.run('audit export --format ndjson --output -');
      expect(readAuditExportEventTypes(auditExport.stdout)).toEqual(
        expect.arrayContaining([...expectedAuditEventTypes]),
      );

      await expectAuditFileExports(admin, app.directory, expectedAuditEventTypes);

      const archivePayload: ProjectResponse = await admin.runJson(
        `project archive --project ${app.projectName} --yes`,
        projectResponseSchema,
      );
      expect(archivePayload.project.archivedAt).not.toBeNull();

      const archivedStatus: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(archivedStatus.stderr).toContain(archivedProjectMessage);

      const archivedDeploymentList: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `deployment list --project ${app.projectName} --output json`,
      );
      expect(archivedDeploymentList.stderr).toContain(archivedProjectMessage);
      await expectAppRouteNotFound(routeUrl, adminAppSessionCookie, '/probe/whoami');

      const unarchivePayload: ProjectResponse = await admin.runJson(
        `project unarchive --project ${app.projectName}`,
        projectResponseSchema,
      );
      expect(unarchivePayload.project.archivedAt).toBeNull();

      const restoredStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(restoredStatus.project.name).toBe(app.projectName);
      expect(
        restoredStatus.deployments.some(
          (deployment: DeploymentReadSummary): boolean => deployment.serviceName === app.serviceName,
        ),
      ).toBe(true);

      const renamedProjectPayload: ProjectResponse = await admin.runJson(
        `project rename ${renamedProjectName} --project ${app.projectName}`,
        projectResponseSchema,
        { cwd: app.directory },
      );
      expect(renamedProjectPayload.project.name).toBe(renamedProjectName);

      const renamedProjectShow: ProjectShowResponse = await admin.runJson('project show', projectShowResponseSchema, {
        cwd: app.directory,
      });
      expect(renamedProjectShow.localProjectName).toBe(renamedProjectName);
      expect(renamedProjectShow.project?.name).toBe(renamedProjectName);

      const renamedStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${renamedProjectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(renamedStatus.project.name).toBe(renamedProjectName);

      const projectListAfterRename: ProjectListResponse = await admin.runJson(
        'project list --full',
        projectListResponseSchema,
      );
      expect(requireProjectOverview(projectListAfterRename, renamedProjectName).name).toBe(renamedProjectName);
      completedCaseCount = 8;
    },
    selfHostedUserSetupTimeoutMs,
  );
});
