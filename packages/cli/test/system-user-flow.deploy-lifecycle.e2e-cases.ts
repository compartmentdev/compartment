import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  captureVariableGroupResponseSchema,
  createOrganizationResponseSchema,
  deleteSsoOidcProviderResponseSchema,
  deploymentInspectResponseSchema,
  deploymentListResponseSchema,
  deploymentRunLogsResponseSchema,
  gitSourceListResponseSchema,
  importVariableGroupResponseSchema,
  importVariablesResponseSchema,
  logoutResponseSchema,
  organizationListResponseSchema,
  organizationSettingsResponseSchema,
  projectListResponseSchema,
  projectShowResponseSchema,
  removeVariableResponseSchema,
  ssoOidcProviderListResponseSchema,
  ssoOidcProviderResponseSchema,
  variableGroupResponseSchema,
  variableListResponseSchema,
  variableResponseSchema,
  whoamiCommandResponseSchema,
  type CaptureVariableGroupResponse,
  type CliRemoteListResponse,
  type CliRemoteResponse,
  type CliRemoteSummary,
  type CreateOrganizationResponse,
  type DeleteSsoOidcProviderResponse,
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
  type LogoutResponse,
  type OrganizationListResponse,
  type OrganizationSettingsResponse,
  type OrganizationSummary,
  type ProjectListResponse,
  type ProjectOverviewSummary,
  type ProjectShowResponse,
  type RemoveVariableResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderSummary,
  type VariableDetail,
  type VariableListItem,
  type VariableListResponse,
  type VariableResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';
import type { SelfHostedUserSetupAppFixture } from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import type { SelfHostedUserSetupCommandResult } from './self-hosted-user-setup-command.harness';
import {
  buildSelfHostedAppHostname,
  configureSelfHostedTrustedOutboundHosts,
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  requireRouteUrl,
  requireSingleActiveDeployment,
  requireSingleInspectedActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import {
  deploymentRunCompletionTimeoutMs,
  expectBlockedPublicControlPlanePaths,
  expectExplicitProjectLifecycleFlow,
  requireDetachedDeploymentRunId,
  waitForDeploymentRuntimeLog,
  waitForDeploymentRunCompletion,
} from './self-hosted-user-setup-deployment-flow.harness';
import { expectCompartmentSkillInstallOnboarding } from './self-hosted-user-setup-agent-onboarding.harness';
import { expectCurrentOrganizationSlug } from './cli-response-test.harness';
import { cliRemoteListResponseSchema, cliRemoteResponseSchema } from './remote-command-response.harness';
import {
  expectK3dProjectNamespaceActive,
  expectK3dWorkerNamespaceIsolation,
} from './self-hosted-user-setup-k3d.harness';
import {
  organizationUseResponseSchema,
  requireProjectOverview,
  requireSsoProvider,
  type OrganizationUseResponse,
} from './system-user-flow-response.harness';

import {
  appBuildMessage,
  appListeningLogText,
  appMessage,
  directFlagValue,
  explicitProjectName,
  invalidRollbackRetentionMessage,
  loggedOutRemoteMessage,
  missingServiceMessage,
  missingVariableGroupMessage,
  noConfiguredLoginMessage,
  oidcIssuerHost,
  oidcIssuerUrl,
  type SystemUserFlowContext,
} from './system-user-flow.e2e.harness';
import {
  createSystemUserFlowContext,
  configureSystemUserFlowAuthSettings,
  loginSystemUserFlowAdmin,
  prepareSystemUserFlowAppDeployment,
  prepareSystemUserFlowVariables,
  type SystemUserFlowAppDeployment,
} from './system-user-flow.shared.e2e.harness';

const deploymentLifecycleCaseTimeoutMs: number = deploymentRunCompletionTimeoutMs + 8 * 60_000;

export function registerSystemUserFlowDeployLifecycleCases(): void {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  let runtime: SelfHostedUserSetupRuntime;
  let advertisedCompartmentUrl: string;
  let app: SelfHostedUserSetupAppFixture;
  let admin: SelfHostedUserSetupCli;
  let viewer: SelfHostedUserSetupCli;
  let routeUrl: string;
  let activeDeployment: DeploymentReadSummary;
  let appProjectId: string;
  let completedCaseCount: number = 0;

  it(
    'case 1/8: installs the single-server system and logs in from a fresh CLI',
    async (): Promise<void> => {
      const initializedContext: SystemUserFlowContext = await createSystemUserFlowContext(setup);
      runtime = initializedContext.runtime;
      advertisedCompartmentUrl = initializedContext.advertisedCompartmentUrl;
      app = initializedContext.app;
      admin = initializedContext.admin;
      viewer = initializedContext.viewer;
      await expectBlockedPublicControlPlanePaths(advertisedCompartmentUrl);
      await expectK3dWorkerNamespaceIsolation();

      const adminBeforeLogin: SelfHostedUserSetupCommandResult = await admin.runFailure('whoami --output json');
      expect(adminBeforeLogin.stderr).toContain(noConfiguredLoginMessage);

      const viewerBeforeLogin: SelfHostedUserSetupCommandResult = await viewer.runFailure('whoami --output json');
      expect(viewerBeforeLogin.stderr).toContain(noConfiguredLoginMessage);

      await loginSystemUserFlowAdmin(initializedContext);

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
      await configureSystemUserFlowAuthSettings(admin);

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
      await prepareSystemUserFlowVariables(admin, app);

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

      const appDeployment: SystemUserFlowAppDeployment = await prepareSystemUserFlowAppDeployment(
        admin,
        app,
        runtime,
        advertisedCompartmentUrl,
      );
      appProjectId = appDeployment.appProjectId;
      routeUrl = appDeployment.routeUrl;
      activeDeployment = appDeployment.activeDeployment;

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

      const explicitProject: ProjectShowResponse = await admin.runJson(
        `project show --project ${explicitProjectName}`,
        projectShowResponseSchema,
      );
      if (explicitProject.project === null) {
        throw new Error('Expected the explicit project to exist remotely.');
      }

      await expectExplicitProjectLifecycleFlow(
        admin,
        explicitProject.project.id,
        explicitProjectName,
        app.serviceName,
        explicitRouteUrl,
      );
      await expectK3dProjectNamespaceActive(appProjectId);
      completedCaseCount = 4;
    },
    deploymentLifecycleCaseTimeoutMs,
  );
}
