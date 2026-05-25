import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';
import { expectPresent, expectSchemaRejects } from './schema-test.helpers';

import {
  activateRequestSchema,
  activateStateResponseSchema,
  buildResourceOutputReference,
  cliLoginStartRequestSchema,
  cliLoginStatusResponseSchema,
  createFirstDeployOnboardingSessionRequestSchema,
  deployRequestSchema,
  firstDeployOnboardingStatusResponseSchema,
  gitHubProviderBootstrapRequestSchema,
  gitHubProviderBootstrapResponseSchema,
  connectGitSourceRequestSchema,
  disconnectGitSourceResponseSchema,
  gitSourceListResponseSchema,
  gitSourceResponseSchema,
  installRequestSchema,
  loginRequestSchema,
  loginDiscoveryRequestSchema,
  loginStateResponseSchema,
  patchFirstDeployOnboardingSessionRequestSchema,
  issuePasswordResetRequestSchema,
  issuePasswordResetResponseSchema,
  resourceResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  resetPasswordStateResponseSchema,
  captureVariableGroupRequestSchema,
  createVariableGroupRequestSchema,
  importVariablesRequestSchema,
  importVariableGroupRequestSchema,
  resourceOutputListResponseSchema,
  resourceOutputQuerySchema,
  resourceOutputResponseSchema,
  setVariableRequestSchema,
  variableGroupBindingRequestSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  variableLocalRunRequestSchema,
  variableLocalRunResponseSchema,
  type ActivateRequest,
  type ActivateStateResponse,
  type CliLoginStartRequest,
  type CliLoginStatusResponse,
  type CaptureVariableGroupRequest,
  type ConnectGitSourceRequest,
  type CreateVariableGroupRequest,
  type DeployRequest,
  type FirstDeployOnboardingStatusResponse,
  type GitHubProviderBootstrapRequest,
  type GitSourceListResponse,
  type GitSourceResponse,
  type DisconnectGitSourceResponse,
  type InstallRequest,
  type LoginRequest,
  type LoginDiscoveryRequest,
  type LoginStateResponse,
  type IssuePasswordResetRequest,
  type IssuePasswordResetResponse,
  type ResourceResponse,
  type ResourceOutputListResponse,
  type ResourceOutputQuery,
  type ResourceOutputResponse,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
  type ResetPasswordStateResponse,
  type ImportVariablesRequest,
  type SetVariableRequest,
  type VariableGroupBindingRequest,
  type VariableGroupResponse,
  type VariableGroupUsagesResponse,
  type VariableLocalRunItem,
  type VariableLocalRunRequest,
  type VariableLocalRunResponse,
} from '../src';

describe('contract schemas auth and deploy', (): void => {
  it('accepts a valid install request', (): void => {
    const result: InstallRequest = installRequestSchema.parse({
      adminEmail: 'admin@example.com',
      adminPassword: 'supersecretpassword',
      baseDomain: 'example.com',
      organizationName: 'Acme Dev',
      organizationSlug: 'acme-dev',
    });

    expect(result.adminEmail).toBe('admin@example.com');
  });

  it('accepts a valid login request', (): void => {
    const result: LoginRequest = loginRequestSchema.parse({
      email: 'admin@example.com',
      password: 'supersecret',
    });

    expect(result.email).toBe('admin@example.com');
  });

  it('accepts a login discovery request that disables browser auto-redirect', (): void => {
    const result: LoginDiscoveryRequest = loginDiscoveryRequestSchema.parse({
      autoRedirect: false,
      email: 'admin@example.com',
      organizationSlug: 'acme-dev',
    });

    expect(result.autoRedirect).toBe(false);
  });

  it('accepts a CLI login start request with an optional email hint', (): void => {
    const result: CliLoginStartRequest = cliLoginStartRequestSchema.parse({
      email: 'admin@example.com',
      onboardingSessionId: 'fdo_123',
      organizationSlug: 'acme-dev',
    });

    expect(result.onboardingSessionId).toBe('fdo_123');
    expect(result.organizationSlug).toBe('acme-dev');
  });

  it('accepts a CLI login start request without an email hint', (): void => {
    const result: CliLoginStartRequest = cliLoginStartRequestSchema.parse({
      organizationSlug: 'acme-dev',
    });

    expect(result.organizationSlug).toBe('acme-dev');
  });

  it('rejects login methods state responses whose SSO options omit provider ids', (): void => {
    const result: SafeParseReturnType<LoginStateResponse, LoginStateResponse> = loginStateResponseSchema.safeParse({
      flowTarget: null,
      localPasswordEnabled: false,
      ssoOptions: [{ buttonText: 'Continue with SSO', loginUrl: '/login/sso?provider=sop_123' }],
      view: 'methods',
    });

    expect(result.success).toBe(false);
  });

  it('accepts CLI login status responses with authenticated terminal state', (): void => {
    const result: CliLoginStatusResponse = cliLoginStatusResponseSchema.parse({
      expiresAt: '2099-04-21T10:10:00.000Z',
      status: 'authenticated',
    });

    expect(result.status).toBe('authenticated');
  });

  it('accepts a deploy request with a trimmed label', (): void => {
    const result: DeployRequest = deployRequestSchema.parse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: '  hotfix auth  ',
      onboardingSessionId: 'fdo_123',
      sourceUploadId: 'sup_123',
    });

    expect(result.label).toBe('hotfix auth');
    expect(result.onboardingSessionId).toBe('fdo_123');
  });

  it('rejects client-controlled first deploy onboarding correlation ids', (): void => {
    expect(
      createFirstDeployOnboardingSessionRequestSchema.parse({
        method: 'cli',
      }),
    ).toEqual({ method: 'cli' });
    expect(
      patchFirstDeployOnboardingSessionRequestSchema.parse({
        skipped: true,
      }),
    ).toEqual({ skipped: true });
    expect(
      patchFirstDeployOnboardingSessionRequestSchema.safeParse({
        cliLoginAttemptId: 'cla_123',
        deploymentRunId: 'drn_123',
        method: 'cli',
        sourceId: 'src_123',
        syncTaskId: 'sst_123',
      }).success,
    ).toBe(false);
  });

  it('accepts server-derived first deploy onboarding status responses', (): void => {
    const result: FirstDeployOnboardingStatusResponse = firstDeployOnboardingStatusResponseSchema.parse({
      session: {
        createdAt: '2026-04-21T10:00:00.000Z',
        id: 'fdo_123',
        method: 'cli',
        organizationSlug: 'acme-dev',
        skippedAt: null,
        state: 'active',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
      status: 'deploy_succeeded',
      statusText: 'First deploy completed.',
    });

    expect(result.status).toBe('deploy_succeeded');
  });

  it('rejects a deploy request with a blank label', (): void => {
    const result: SafeParseReturnType<DeployRequest, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: '   ',
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a deploy request with an oversized label', (): void => {
    const result: SafeParseReturnType<DeployRequest, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: 'a'.repeat(101),
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a deploy request with control characters in the label', (): void => {
    const result: SafeParseReturnType<DeployRequest, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: 'hotfix\t\u001b[31mauth',
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('accepts only literal resource env summaries', (): void => {
    const response: ResourceResponse = buildResourceResponse();

    expect(resourceResponseSchema.parse(response).resource.env).toEqual([
      {
        keyName: 'POSTGRES_DB',
        sourceType: 'literal',
        variableName: null,
      },
    ]);

    const variableSourceResult: SafeParseReturnType<ResourceResponse, ResourceResponse> =
      resourceResponseSchema.safeParse({
        ...response,
        resource: {
          ...response.resource,
          env: [
            {
              keyName: 'POSTGRES_PASSWORD',
              sourceType: 'variable',
              variableName: 'POSTGRES_PASSWORD',
            },
          ],
        },
      });

    expect(variableSourceResult.success).toBe(false);
  });

  it('accepts resource output responses with hidden sensitive values', (): void => {
    const listResponse: ResourceOutputListResponse = resourceOutputListResponseSchema.parse({
      ...buildResourceResponse(),
      outputs: [
        {
          name: 'connection-url',
          sensitivity: 'sensitive',
          value: null,
          valueFingerprint: null,
          valueHidden: true,
        },
      ],
    });
    const showResponse: ResourceOutputResponse = resourceOutputResponseSchema.parse({
      ...buildResourceResponse(),
      output: listResponse.outputs[0],
    });

    expect(showResponse.output.valueHidden).toBe(true);
    expect(showResponse.output.valueFingerprint).toBeNull();
  });

  it('parses resource output reveal query values strictly', (): void => {
    const baseQuery: Omit<ResourceOutputQuery, 'reveal'> = {
      outputName: 'connection-url',
      projectName: 'billing',
      resourceName: 'postgres',
    };

    expect(resourceOutputQuerySchema.parse({ ...baseQuery, reveal: 'true' }).reveal).toBe(true);
    expect(resourceOutputQuerySchema.parse({ ...baseQuery, reveal: 'false' }).reveal).toBe(false);
    expect(resourceOutputQuerySchema.parse({ ...baseQuery, outputName: 'db.primary-url' }).outputName).toBe(
      'db.primary-url',
    );
    expect(resourceOutputQuerySchema.parse(baseQuery).reveal).toBeUndefined();
    expect(resourceOutputQuerySchema.safeParse({ ...baseQuery, reveal: '1' }).success).toBe(false);
  });

  it('rejects a deploy request with Unicode line separators in the label', (): void => {
    const result: SafeParseReturnType<DeployRequest, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: 'release\u2028hotfix',
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a git source connect request', (): void => {
    const result: ConnectGitSourceRequest = connectGitSourceRequestSchema.parse({
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: true,
      defaultEnvironmentName: 'production',
      descriptorPathToInclude: 'apps/billing/compartment.yml',
      providerHost: 'github.com',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      syncBranchName: 'main',
    });

    expect(result.defaultAutoDeployEnabled).toBe(true);
    expect(result.defaultEnvironmentName).toBe('production');
    expect(result.descriptorPathToInclude).toBe('apps/billing/compartment.yml');
  });

  it('accepts a git source connect request with manual source defaults', (): void => {
    const result: ConnectGitSourceRequest = connectGitSourceRequestSchema.parse({
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: false,
      defaultEnvironmentName: 'staging',
      providerHost: 'github.com',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      syncBranchName: 'main',
    });

    expect(result.defaultAutoDeployEnabled).toBe(false);
    expect(result.defaultEnvironmentName).toBe('staging');
    expect(result.providerHost).toBe('github.com');
  });

  it('normalizes git source provider hosts', (): void => {
    const result: ConnectGitSourceRequest = connectGitSourceRequestSchema.parse({
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: true,
      defaultEnvironmentName: 'production',
      providerHost: 'GitHub.COM',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      syncBranchName: 'main',
    });

    expect(result.providerHost).toBe('github.com');
  });

  it('rejects invalid git source provider hosts', (): void => {
    expect(
      (): ConnectGitSourceRequest =>
        connectGitSourceRequestSchema.parse({
          autoAdoptNewApps: true,
          defaultAutoDeployEnabled: true,
          defaultEnvironmentName: 'production',
          providerHost: 'https://github.com',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          syncBranchName: 'main',
        }),
    ).toThrow();
  });

  it('accepts a git source response with bindings', (): void => {
    const result: GitSourceResponse = gitSourceResponseSchema.parse({
      source: {
        autoAdoptNewApps: true,
        bindings: [
          {
            autoDeployEnabled: true,
            branchName: 'main',
            descriptorPath: 'compartment.yml',
            environmentName: 'production',
            id: 'sbd_123',
            projectId: 'prj_123',
            projectName: 'smoke-web',
            status: 'active',
          },
        ],
        defaultAutoDeployEnabled: true,
        defaultBranchName: 'main',
        defaultEnvironmentName: 'production',
        displayName: 'acme/mono',
        exclusions: [],
        id: 'src_123',
        latestSync: {
          candidates: [
            {
              blockedReason: 'Project "billing" already has an active Git binding.',
              derivedWatchPaths: [],
              descriptorDirectory: 'apps/billing',
              descriptorPath: 'apps/billing/compartment.yml',
              id: 'ssc_123',
              projectName: null,
              status: 'blocked',
            },
          ],
          failureReason: null,
          id: 'sst_123',
          requestedBranchName: 'main',
          resolvedCommitSha: 'sha_123',
          status: 'completed',
        },
        providerHost: 'github.com',
        repositoryCloneUrl: 'https://github.com/acme/mono.git',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
        status: 'active',
      },
    });

    expect(result.source.bindings).toHaveLength(1);
    expect(result.source.latestSync?.candidates[0]?.projectName).toBeNull();
  });

  it('accepts an active GitHub provider bootstrap response without a browser URL', (): void => {
    expect(
      gitHubProviderBootstrapResponseSchema.parse({
        bootstrapStateId: null,
        browserUrl: null,
        installationAccountLogin: 'acme',
        installationId: '12345',
        providerHost: 'github.com',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
        status: 'active',
      }),
    ).toMatchObject({
      providerHost: 'github.com',
      status: 'active',
    });
  });

  it('accepts a GitHub provider bootstrap request', (): void => {
    const result: GitHubProviderBootstrapRequest = gitHubProviderBootstrapRequestSchema.parse({
      providerHost: 'GitHub.com',
      repositoryOwner: 'acme',
      returnTo: '/onboarding?method=git',
    });

    expect(result.providerHost).toBe('github.com');
    expect(result.returnTo).toBe('/onboarding?method=git');
  });

  it('rejects unsafe GitHub provider bootstrap return paths', (): void => {
    for (const returnTo of [
      'https://evil.example/phish',
      '//evil.example/phish',
      '/%2e%2e/admin',
      '/safe%2fdashboard',
    ]) {
      expect(
        gitHubProviderBootstrapRequestSchema.safeParse({
          providerHost: 'github.com',
          repositoryOwner: 'acme',
          returnTo,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts a git source list response', (): void => {
    const result: GitSourceListResponse = gitSourceListResponseSchema.parse({
      sources: [
        {
          defaultBranchName: 'main',
          displayName: 'acme/mono',
          id: 'src_123',
          providerHost: 'github.com',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          status: 'active',
        },
      ],
    });

    expect(result.sources[0]?.displayName).toBe('acme/mono');
  });

  it('accepts a git source disconnect response', (): void => {
    const result: DisconnectGitSourceResponse = disconnectGitSourceResponseSchema.parse({
      sourceId: 'src_123',
      success: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts printable separator characters in a deploy label', (): void => {
    const result: DeployRequest = deployRequestSchema.parse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      label: '  release=1;hotfix  ',
      sourceUploadId: 'sup_123',
    });

    expect(result.label).toBe('release=1;hotfix');
  });

  it('accepts a service-scoped variable set request without service metadata', (): void => {
    const result: SetVariableRequest = setVariableRequestSchema.parse({
      keyName: 'QUEUE_TOKEN',
      projectName: 'billing',
      serviceName: 'worker',
      value: 'queue-token',
    });

    expect(result.serviceName).toBe('worker');
  });

  it('accepts service-scoped variable set requests from resource outputs', (): void => {
    const result: SetVariableRequest = setVariableRequestSchema.parse({
      fromResource: 'postgres.db.primary-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
      serviceName: 'worker',
    });

    expect(result.fromResource).toBe('postgres.db.primary-url');
  });

  it('formats resource output references from validated names', (): void => {
    expect(buildResourceOutputReference({ outputName: 'db.primary-url', resourceName: 'postgres' })).toBe(
      'postgres.db.primary-url',
    );
  });

  it('rejects resource output variable bindings without a service target', (): void => {
    const result: SafeParseReturnType<SetVariableRequest, SetVariableRequest> = setVariableRequestSchema.safeParse({
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'billing',
    });

    expect(result.success).toBe(false);
  });

  it('rejects legacy serviceDefinition in variable set requests', (): void => {
    const result: SafeParseReturnType<SetVariableRequest, SetVariableRequest> = setVariableRequestSchema.safeParse({
      keyName: 'QUEUE_TOKEN',
      projectName: 'billing',
      serviceDefinition: {
        kind: 'worker',
        path: './worker',
      },
      serviceName: 'worker',
      value: 'queue-token',
    });

    expect(result.success).toBe(false);
  });

  it('rejects legacy serviceDefinition in variable import requests', (): void => {
    const result: SafeParseReturnType<ImportVariablesRequest, ImportVariablesRequest> =
      importVariablesRequestSchema.safeParse({
        entries: [{ keyName: 'QUEUE_TOKEN', value: 'queue-token' }],
        projectName: 'billing',
        serviceDefinition: {
          kind: 'worker',
          path: './worker',
        },
        serviceName: 'worker',
      });

    expect(result.success).toBe(false);
  });

  it('accepts variable group create and capture requests', (): void => {
    const createRequest: CreateVariableGroupRequest = createVariableGroupRequestSchema.parse({
      description: '  Shared production credentials  ',
      variableGroupName: 'postgres-prod',
    });
    const captureRequest: CaptureVariableGroupRequest = captureVariableGroupRequestSchema.parse({
      effective: true,
      environmentName: 'production',
      projectName: 'billing',
      serviceName: 'worker',
      variableGroupName: 'worker-runtime',
    });

    expect(createRequest.description).toBe('Shared production credentials');
    expect(captureRequest.effective).toBe(true);
    expect(captureRequest.serviceName).toBe('worker');
  });

  it('rejects duplicate keys in variable group import requests', (): void => {
    expectSchemaRejects(importVariableGroupRequestSchema, {
      entries: [
        { keyName: 'DATABASE_URL', value: 'postgres://one' },
        { keyName: 'DATABASE_URL', value: 'postgres://two' },
      ],
      variableGroupName: 'postgres-prod',
    });
  });

  it('accepts variable group metadata and usages responses', (): void => {
    const response: VariableGroupResponse = variableGroupResponseSchema.parse({
      variableGroup: {
        createdAt: '2026-05-05T09:00:00.000Z',
        description: 'Shared production credentials',
        name: 'postgres-prod',
        updatedAt: '2026-05-05T09:30:00.000Z',
        variableCount: 2,
        variables: [
          {
            keyName: 'DATABASE_URL',
            sensitivity: 'sensitive',
          },
          {
            keyName: 'DB_SSLMODE',
            sensitivity: 'plain',
          },
        ],
      },
    });
    const usages: VariableGroupUsagesResponse = variableGroupUsagesResponseSchema.parse({
      usages: [
        {
          environmentName: 'production',
          projectName: 'billing',
          resourceName: null,
          serviceName: null,
        },
        {
          environmentName: 'production',
          projectName: 'checkout',
          resourceName: null,
          serviceName: 'api',
        },
      ],
      variableGroup: {
        createdAt: '2026-05-05T09:00:00.000Z',
        description: 'Shared production credentials',
        name: 'postgres-prod',
        updatedAt: '2026-05-05T09:30:00.000Z',
        variableCount: 2,
      },
    });

    expect(response.variableGroup.variables[0]?.keyName).toBe('DATABASE_URL');
    expect(usages.usages[1]?.serviceName).toBe('api');
  });

  it('accepts variable group binding requests and rejects legacy serviceDefinition', (): void => {
    const request: VariableGroupBindingRequest = variableGroupBindingRequestSchema.parse({
      environmentName: 'production',
      projectName: 'billing',
      serviceName: 'api',
      variableGroupName: 'sentry-shared',
    });

    expect(request.variableGroupName).toBe('sentry-shared');
    expectSchemaRejects(variableGroupBindingRequestSchema, {
      environmentName: 'production',
      projectName: 'billing',
      serviceDefinition: {
        kind: 'worker',
        path: './worker',
      },
      serviceName: 'worker',
      variableGroupName: 'postgres-prod',
    });
    expectSchemaRejects(captureVariableGroupRequestSchema, {
      environmentName: 'production',
      projectName: 'billing',
      serviceDefinition: {
        kind: 'worker',
        path: './worker',
      },
      serviceName: 'worker',
      variableGroupName: 'worker-runtime',
    });
  });

  it('accepts local-run requests and plaintext responses', (): void => {
    const request: VariableLocalRunRequest = variableLocalRunRequestSchema.parse(
      buildVariableLocalRunRequest({
        commandName: 'node',
      }),
    );
    const response: VariableLocalRunResponse = variableLocalRunResponseSchema.parse(
      buildVariableLocalRunResponse([buildEnvironmentLocalRunVariable('DATABASE_URL', 'postgres://local')]),
    );

    expect(request.environmentName).toBe('development');
    expect(expectPresent(response.variables[0], 'local-run variable').value).toBe('postgres://local');
  });

  it('rejects local-run productionAck mismatches', (): void => {
    const missingAck: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse(
        buildVariableLocalRunRequest({
          environmentName: 'production',
          productionAck: false,
        }),
      );
    const unexpectedAck: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse(
        buildVariableLocalRunRequest({
          environmentName: 'development',
          productionAck: true,
        }),
      );

    expect(missingAck.success).toBe(false);
    expect(unexpectedAck.success).toBe(false);
  });

  it('rejects invalid local-run command names and unknown fields', (): void => {
    const badCommandName: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse(
        buildVariableLocalRunRequest({
          commandName: 'node\n--inspect',
        }),
      );
    const pathCommandName: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse(
        buildVariableLocalRunRequest({
          commandName: '/usr/bin/node',
        }),
      );
    const argumentCommandName: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse(
        buildVariableLocalRunRequest({
          commandName: 'node --inspect',
        }),
      );
    const unknownField: SafeParseReturnType<VariableLocalRunRequest, VariableLocalRunRequest> =
      variableLocalRunRequestSchema.safeParse({
        ...buildVariableLocalRunRequest(),
        variableNames: ['DATABASE_URL'],
      });

    expect(badCommandName.success).toBe(false);
    expect(pathCommandName.success).toBe(false);
    expect(argumentCommandName.success).toBe(false);
    expect(unknownField.success).toBe(false);
  });

  it('accepts a valid activation request', (): void => {
    const result: ActivateRequest = activateRequestSchema.parse({
      bootstrapToken: 'bootstrap_123',
      email: 'viewer@example.com',
      password: 'supersecret',
    });

    expect(result.bootstrapToken).toBe('bootstrap_123');
  });

  it('accepts a valid password reset request', (): void => {
    const result: ResetPasswordRequest = resetPasswordRequestSchema.parse({
      email: 'viewer@example.com',
      password: 'supersecret',
      resetToken: 'reset_123',
    });

    expect(result.resetToken).toBe('reset_123');
  });

  it('accepts a valid password reset response', (): void => {
    const result: ResetPasswordResponse = resetPasswordResponseSchema.parse({
      organizations: [],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_123',
        type: 'user',
      },
      sessionToken: 'session-token',
    });

    expect(result.sessionToken).toBe('session-token');
  });

  it('accepts a valid password reset state response', (): void => {
    const result: ResetPasswordStateResponse = resetPasswordStateResponseSchema.parse({
      email: 'viewer@example.com',
      flowTarget: null,
      hasToken: true,
      principalEmail: 'admin@example.com',
    });

    expect(result.hasToken).toBe(true);
  });

  it('accepts an activation state response that disables local password activation', (): void => {
    const result: ActivateStateResponse = activateStateResponseSchema.parse({
      email: 'viewer@example.com',
      flowTarget: null,
      hasToken: true,
      unavailableReason: 'local_password_disabled',
    });

    expect(result.unavailableReason).toBe('local_password_disabled');
  });

  it('rejects activation-only fields on password reset state responses', (): void => {
    const result: SafeParseReturnType<ResetPasswordStateResponse, ResetPasswordStateResponse> =
      resetPasswordStateResponseSchema.safeParse({
        email: 'viewer@example.com',
        flowTarget: null,
        hasToken: true,
        unavailableReason: 'local_password_disabled',
      });

    expect(result.success).toBe(false);
  });

  it('accepts a valid password reset issue request', (): void => {
    const result: IssuePasswordResetRequest = issuePasswordResetRequestSchema.parse({
      email: 'viewer@example.com',
    });

    expect(result.email).toBe('viewer@example.com');
  });

  it('accepts a valid password reset issue response', (): void => {
    const result: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse({
      email: 'viewer@example.com',
      expiresAt: '2026-04-29T12:00:00.000Z',
      resetToken: 'reset-token',
      resetUrl: 'https://console.example.com/reset-password?email=viewer%40example.com&token=reset-token',
    });

    expect(result.resetUrl).toContain('/reset-password?');
  });
});

interface BuildVariableLocalRunRequestInput {
  commandName?: string | null | undefined;
  environmentName?: string | undefined;
  productionAck?: boolean | undefined;
  resourceName?: string | null | undefined;
  serviceName?: string | null | undefined;
}

function buildResourceResponse(): ResourceResponse {
  return {
    environment: {
      createdAt: '2026-03-21T10:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-21T10:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-21T10:00:00.000Z',
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: '2026-03-21T10:00:00.000Z',
    },
    resource: {
      containerId: 'container_123',
      createdAt: '2026-03-21T10:00:00.000Z',
      env: [
        {
          keyName: 'POSTGRES_DB',
          sourceType: 'literal',
          variableName: null,
        },
      ],
      hostname: 'postgres.production.billing.resource.internal',
      id: 'res_123',
      image: 'postgres:16',
      name: 'postgres',
      ports: [5432],
      readiness: null,
      restartPolicy: 'unless-stopped',
      status: 'running',
      updatedAt: '2026-03-21T10:00:00.000Z',
      volumes: [],
    },
  };
}

function buildVariableLocalRunRequest(input: BuildVariableLocalRunRequestInput = {}): VariableLocalRunRequest {
  return {
    commandName: input.commandName === undefined ? undefined : input.commandName,
    environmentName: input.environmentName ?? 'development',
    productionAck: input.productionAck ?? false,
    projectName: 'billing',
    resourceName: input.resourceName ?? null,
    serviceName: input.serviceName ?? null,
  };
}

function buildVariableLocalRunResponse(variables: VariableLocalRunItem[]): VariableLocalRunResponse {
  return {
    accessEventId: 'vae_123',
    environment: {
      createdAt: '2026-03-21T10:00:00.000Z',
      id: 'env_123',
      name: 'development',
      projectId: 'prj_123',
      updatedAt: '2026-03-21T10:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-21T10:00:00.000Z',
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: '2026-03-21T10:00:00.000Z',
    },
    resourceName: null,
    serviceName: null,
    variables,
  };
}

function buildEnvironmentLocalRunVariable(keyName: string, value: string): VariableLocalRunItem {
  return {
    keyName,
    scopeResourceName: null,
    scopeServiceName: null,
    scopeType: 'environment',
    sensitivity: 'sensitive',
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value,
    valueFingerprint: 'a'.repeat(64),
  };
}
