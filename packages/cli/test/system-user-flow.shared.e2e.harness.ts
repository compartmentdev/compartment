import { expect } from 'vitest';
import {
  deleteSsoOidcProviderResponseSchema,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type OrganizationAuthSettingsResponse,
  organizationAuthSettingsResponseSchema,
  projectShowResponseSchema,
  resourceResponseSchema,
  ssoOidcProviderListResponseSchema,
  ssoOidcProviderResponseSchema,
  type ProjectShowResponse,
  type ResourceResponse,
  type DeleteSsoOidcProviderResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderSummary,
  type VariableDetail,
  type VariableGroupBindingResponse,
  type VariableGroupListResponse,
  type VariableGroupResponse,
  type VariableGroupUsage,
  type VariableGroupUsagesResponse,
  type VariableGroupVariable,
  type VariableResponse,
  variableGroupBindingResponseSchema,
  variableGroupListResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  variableResponseSchema,
} from '@compartment/contracts';
import {
  disableSelfHostedUserSetupResourceRelease,
  enableSelfHostedUserSetupResourceRelease,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import type { SelfHostedUserSetupCommandResult } from './self-hosted-user-setup-command.harness';
import {
  buildSelfHostedAdvertisedCompartmentUrl,
  configureSelfHostedTrustedOutboundHosts,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import {
  expectAppBuildMessage,
  expectAppDirectFlag,
  expectAppEnvMessage,
  expectAppLogoutRevokesAppOnly,
  expectControlPlaneLogoutRevokesApp,
  expectTrustedAppIngress,
  readAppBrowserSessionsWithRetry,
  readAppSessionCookieWithRetry,
} from './self-hosted-user-setup-app-probe.harness';
import type { SelfHostedUserSetupBrowserSessions } from './self-hosted-user-setup-http.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  requireRouteUrl,
  requireSingleActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import { waitForRunningResource } from './self-hosted-user-setup-deployment-flow.harness';
import {
  appBuildMessage,
  appMessage,
  directFlagValue,
  oidcIssuerHost,
  oidcIssuerUrl,
  SystemUserFlowContext,
} from './system-user-flow.e2e.harness';
import { requireSsoProvider } from './system-user-flow-response.harness';
import type { SystemUserFlowAppDeployment, SystemUserFlowVariableSetup } from './system-user-flow.shared.e2e.types';

export async function createSystemUserFlowContext(setup: SelfHostedUserSetupHarness): Promise<SystemUserFlowContext> {
  const runtime: SelfHostedUserSetupRuntime = await setup.install();
  const app: SelfHostedUserSetupAppFixture = await setup.createAppFixture({ includeBackupRetentionSchedule: true });
  const admin: SelfHostedUserSetupCli = await setup.createFreshCli();
  const viewer: SelfHostedUserSetupCli = await setup.createFreshCli();
  const context: SystemUserFlowContext = new SystemUserFlowContext();
  context.runtime = runtime;
  context.advertisedCompartmentUrl = buildSelfHostedAdvertisedCompartmentUrl(runtime.compartmentUrl);
  context.app = app;
  context.admin = admin;
  context.viewer = viewer;
  return context;
}

export async function loginSystemUserFlowAdmin(context: SystemUserFlowContext): Promise<void> {
  const { runtime, admin } = context;
  await admin.runBrowserLogin(
    `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
    {
      email: runtime.adminEmail,
      password: runtime.adminPassword,
    },
    { requestOrigin: runtime.apiUrl },
  );
}

export async function configureSystemUserFlowAuthSettings(admin: SelfHostedUserSetupCli): Promise<void> {
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
}

export async function configureSystemUserFlowSsoOidcProvider(admin: SelfHostedUserSetupCli): Promise<void> {
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
}

export async function prepareSystemUserFlowVariables(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
): Promise<SystemUserFlowVariableSetup> {
  const initialVariableGroups: VariableGroupListResponse = await admin.runJson(
    'variable group list',
    variableGroupListResponseSchema,
  );
  const createdGroup: VariableGroupResponse = await admin.runJson(
    `variable group create ${app.variableGroupName}`,
    variableGroupResponseSchema,
  );
  const groupsAfterCreate: VariableGroupListResponse = await admin.runJson(
    'variable group list',
    variableGroupListResponseSchema,
  );
  const messageGroup: VariableGroupResponse = await admin.runJson(
    `variable group put ${app.variableGroupName} E2E_MESSAGE ${appMessage}`,
    variableGroupResponseSchema,
  );
  const shownGroup: VariableGroupResponse = await admin.runJson(
    `variable group show ${app.variableGroupName}`,
    variableGroupResponseSchema,
  );
  const binding: VariableGroupBindingResponse = await admin.runJson(
    `variable bind ${app.variableGroupName} --env ${app.environmentName}`,
    variableGroupBindingResponseSchema,
    { cwd: app.directory },
  );
  const variableGroupUsages: VariableGroupUsagesResponse = await admin.runJson(
    `variable group usages ${app.variableGroupName}`,
    variableGroupUsagesResponseSchema,
  );
  const directVariablePayload: VariableResponse = await admin.runJson(
    `variable set DIRECT_FLAG ${directFlagValue} --env ${app.environmentName}`,
    variableResponseSchema,
    { cwd: app.directory },
  );
  const buildVariablePayload: VariableResponse = await admin.runJson(
    `variable set E2E_BUILD_MESSAGE ${appBuildMessage} --env ${app.environmentName}`,
    variableResponseSchema,
    { cwd: app.directory },
  );

  expect(initialVariableGroups.variableGroups).toEqual([]);
  expect(createdGroup.variableGroup.name).toBe(app.variableGroupName);
  expect(groupsAfterCreate.variableGroups).toEqual([
    expect.objectContaining({
      name: app.variableGroupName,
      variableCount: 0,
    }),
  ]);
  expect(messageGroup.variableGroup.variables).toEqual([
    expect.objectContaining({
      keyName: 'E2E_MESSAGE',
      sensitivity: 'plain',
    } satisfies Partial<VariableGroupVariable>),
  ]);
  expect(shownGroup.variableGroup.variables).toEqual([
    expect.objectContaining({
      keyName: 'E2E_MESSAGE',
      sensitivity: 'plain',
    } satisfies Partial<VariableGroupVariable>),
  ]);
  expect(binding.variableGroupName).toBe(app.variableGroupName);
  expect(variableGroupUsages.usages).toEqual([
    expect.objectContaining({
      environmentName: app.environmentName,
      projectName: app.projectName,
      resourceName: null,
      serviceName: null,
    } satisfies Partial<VariableGroupUsage>),
  ]);
  expect(directVariablePayload.variable).toEqual(
    expect.objectContaining({
      keyName: 'DIRECT_FLAG',
      sensitivity: 'plain',
      sourceType: 'direct',
      value: directFlagValue,
      valueHidden: false,
    } satisfies Partial<VariableDetail>),
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

  return {
    initialVariableGroups,
    createdGroup,
    groupsAfterCreate,
    messageGroup,
    shownGroup,
    binding,
    variableGroupUsages,
    directVariablePayload,
    buildVariablePayload,
  };
}

export async function prepareSystemUserFlowStagingEnvironment(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
  buildMessage: string,
): Promise<VariableResponse> {
  return await admin.runJson(`variable set E2E_BUILD_MESSAGE ${buildMessage} --env staging`, variableResponseSchema, {
    cwd: app.directory,
  });
}

export async function prepareSystemUserFlowAppDeployment(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
  runtime: SelfHostedUserSetupRuntime,
  advertisedCompartmentUrl: string,
): Promise<SystemUserFlowAppDeployment> {
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

  const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
    cwd: app.directory,
  });
  const deployedProject: ProjectShowResponse = await admin.runJson('project show', projectShowResponseSchema, {
    cwd: app.directory,
  });
  if (deployedProject.project === null) {
    throw new Error('Expected the deployed project to be remotely connected.');
  }
  expect(requireSingleActiveDeployment(deployPayload, app.serviceName).status).toBe('succeeded');
  expect(deployPayload.resources).toEqual([
    expect.objectContaining({
      name: app.resourceName,
    }),
  ]);

  const bootstrapPayload: ResourceResponse = await admin.runJson(
    `resource bootstrap --project ${app.projectName} --resource ${app.resourceName}`,
    resourceResponseSchema,
  );
  expect(bootstrapPayload.resource.name).toBe(app.resourceName);
  await waitForRunningResource(admin, app.projectName, app.resourceName);
  await enableSelfHostedUserSetupResourceRelease(app);
  let resourceReleaseDeployPayload: SelfHostedDeployCommandResponse;
  try {
    resourceReleaseDeployPayload = await admin.runJson('deploy', deployCommandResponseParser, { cwd: app.directory });
  } finally {
    await disableSelfHostedUserSetupResourceRelease(app);
  }
  expect(requireSingleActiveDeployment(resourceReleaseDeployPayload, app.serviceName).status).toBe('succeeded');

  const statusPayload: DeploymentStatusResponse = await admin.runJson(
    `status --project ${app.projectName}`,
    deploymentStatusCommandResponseParser,
  );
  const routeUrl: string = requireRouteUrl(statusPayload, app.serviceName);
  const activeDeployment: DeploymentReadSummary = requireSingleActiveDeployment(statusPayload, app.serviceName);
  let adminBrowserSessions: SelfHostedUserSetupBrowserSessions = await readAppBrowserSessionsWithRetry(routeUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  let adminAppSessionCookie: string = adminBrowserSessions.appSessionCookie;
  await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);
  await expectAppDirectFlag(routeUrl, adminAppSessionCookie, directFlagValue);
  await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);
  await expectTrustedAppIngress(routeUrl, adminAppSessionCookie, runtime.adminEmail, runtime.organizationSlug);
  await expectAppLogoutRevokesAppOnly(advertisedCompartmentUrl, routeUrl, adminBrowserSessions, runtime.adminEmail);

  adminBrowserSessions = await readAppBrowserSessionsWithRetry(routeUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  await expectControlPlaneLogoutRevokesApp(advertisedCompartmentUrl, routeUrl, adminBrowserSessions);

  adminAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);
  await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);

  return {
    databaseUrlBindingPayload,
    deployPayload,
    appProjectId: deployedProject.project.id,
    bootstrapPayload,
    resourceReleaseDeployPayload,
    routeUrl,
    activeDeployment,
    adminAppSessionCookie,
  };
}
