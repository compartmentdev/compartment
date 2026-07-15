import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';
import {
  appAccessBrowserFlowTargetSchema,
  compartmentAppSessionCookieName,
  compartmentCliLoginAttemptCookieName,
  compartmentCsrfCookieName,
  compartmentReservedCookieNamePrefixes,
  compartmentSessionCookieName,
  readCompartmentAppFlowCookieName,
  type AppAccessBrowserFlowTarget,
} from '../src/contracts/app-access-protocol.contract';

import {
  appAccessExchangeRequestSchema,
  appAccessStateResponseSchema,
  compartmentAuthoredDescriptorSchema,
  createErrorResponse,
  deploymentListResponseSchema,
  deploymentStatusResponseSchema,
  deployRequestSchema,
  deployResponseSchema,
  edgeInvalidateAppSessionsRequestSchema,
  healthResponseSchema,
  compartmentRoutesFileSchema,
  deploymentRunLogsQuerySchema,
  projectReadResponseSchema,
  projectShowResponseSchema,
  type AppAccessExchangeRequest,
  type AppAccessProxyRouteState,
  type AppAccessRouteState,
  type AppAccessStateResponse,
  type AppAccessStateSnapshot,
  type CompartmentAuthoredDescriptor,
  type DeployResponse,
  type DeployRequest,
  type DeployRequestInput,
  type EdgeInvalidateAppSessionsRequest,
  type HealthResponse,
  type DeploymentListResponse,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type CompartmentRoutesFile,
  type ProjectReadResponse,
  type ProjectShowResponse,
  type SourceUploadSummary,
  sourceUploadCreateQuerySchema,
  sourceUploadSummarySchema,
} from '../src';
import { buildDeploymentReadSummary, buildDeploymentStatusResponse } from './schema-test.fixtures';
import { expectPresent } from './schema-test.helpers';
import type { ErrorResponsePayload } from './schemas.test.types';

describe('contract schemas deployment and app access', (): void => {
  it('accepts valid health response payloads', (): void => {
    const healthPayload: HealthResponse = healthResponseSchema.parse({
      service: 'api',
      status: 'ok',
      timestamp: '2026-03-21T10:00:00.000Z',
    });

    expect(healthPayload.service).toBe('api');
  });

  it('accepts valid compartment routes files', (): void => {
    const result: CompartmentRoutesFile = compartmentRoutesFileSchema.parse({
      routes: [
        {
          on: 'web',
          path: '/api/*',
          stripPrefix: '/api',
          to: 'backoffice',
        },
      ],
      version: 1,
    });

    expect(expectPresent(result.routes[0], 'route').to).toBe('backoffice');
  });

  it('rejects wildcard-looking transform paths in compartment routes files', (): void => {
    const result: SafeParseReturnType<CompartmentRoutesFile, CompartmentRoutesFile> =
      compartmentRoutesFileSchema.safeParse({
        routes: [
          {
            on: 'web',
            path: '/api/*',
            replacePrefix: '/v1/*',
            to: 'backoffice',
          },
        ],
        version: 1,
      });

    expect(result.success).toBe(false);
  });

  it('accepts app access state payloads with proxied service routes', (): void => {
    const result: AppAccessStateResponse = appAccessStateResponseSchema.parse({
      state: {
        grants: [],
        onDemandTlsHosts: [],
        compartmentUrl: 'http://console.example.com',
        routes: [
          {
            accessMode: 'authenticated',
            host: 'smoke-multi-service.example.com',
            organizationId: 'org_123',
            organizationSlug: 'acme-dev',
            proxyRoutes: [
              {
                on: 'web',
                path: '/api/*',
                stripPrefix: '/api',
                target: {
                  accessMode: 'authenticated',
                  routeScopeId: 'org_123',
                  routeScopeType: 'organization',
                  scopeChain: [
                    {
                      scopeId: 'org_123',
                      scopeType: 'organization',
                    },
                  ],
                  upstreamHost: 'app-backoffice.cpt-project.svc',
                  upstreamPort: 80,
                },
                to: 'backoffice',
              },
            ],
            upstreamHost: 'app-web.cpt-project.svc',
            upstreamPort: 80,
            routeScopeId: 'org_123',
            routeScopeType: 'organization',
            scopeChain: [
              {
                scopeId: 'org_123',
                scopeType: 'organization',
              },
            ],
          },
        ],
      },
    });

    const state: AppAccessStateSnapshot = expectPresent(result.state, 'app access state');
    const route: AppAccessRouteState = expectPresent(state.routes[0], 'app access route');
    const proxyRoute: AppAccessProxyRouteState = expectPresent(route.proxyRoutes[0], 'proxy route');

    expect(proxyRoute.target?.upstreamPort).toBe(80);
  });

  it('rejects app access proxy targets with partial upstream coordinates', (): void => {
    const result: SafeParseReturnType<AppAccessStateResponse, AppAccessStateResponse> =
      appAccessStateResponseSchema.safeParse({
        state: {
          grants: [],
          onDemandTlsHosts: [],
          compartmentUrl: 'http://console.example.com',
          routes: [
            {
              accessMode: 'authenticated',
              host: 'smoke-multi-service.example.com',
              organizationId: 'org_123',
              organizationSlug: 'acme-dev',
              proxyRoutes: [
                {
                  on: 'web',
                  path: '/api/*',
                  stripPrefix: '/api',
                  target: {
                    accessMode: 'authenticated',
                    routeScopeId: 'org_123',
                    routeScopeType: 'organization',
                    scopeChain: [
                      {
                        scopeId: 'org_123',
                        scopeType: 'organization',
                      },
                    ],
                    upstreamHost: null,
                    upstreamPort: 80,
                  },
                  to: 'backoffice',
                },
              ],
              upstreamHost: 'app-web.cpt-project.svc',
              upstreamPort: 80,
              routeScopeId: 'org_123',
              routeScopeType: 'organization',
              scopeChain: [
                {
                  scopeId: 'org_123',
                  scopeType: 'organization',
                },
              ],
            },
          ],
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['state', 'routes', 0, 'proxyRoutes', 0, 'target'],
        }),
      );
    }
  });

  it('accepts cookie-safe app access flow states across the browser flow contracts', (): void => {
    const flowTarget: AppAccessBrowserFlowTarget = appAccessBrowserFlowTargetSchema.parse({
      host: 'billing.localhost',
      path: '/dashboard',
      state: 'flow_state-1',
    });
    const exchangeRequest: AppAccessExchangeRequest = appAccessExchangeRequestSchema.parse({
      code: 'abc',
      host: 'billing.localhost',
      state: 'flow_state-1',
    });

    expect(flowTarget.state).toBe('flow_state-1');
    expect(exchangeRequest.state).toBe('flow_state-1');
  });

  it('rejects app access flow states that are unsafe for cookie-backed callback binding', (): void => {
    const flowTargetResult: SafeParseReturnType<AppAccessBrowserFlowTarget, AppAccessBrowserFlowTarget> =
      appAccessBrowserFlowTargetSchema.safeParse({
        host: 'billing.localhost',
        path: '/dashboard',
        state: 'flow/state',
      });
    const exchangeRequestResult: SafeParseReturnType<AppAccessExchangeRequest, AppAccessExchangeRequest> =
      appAccessExchangeRequestSchema.safeParse({
        code: 'abc',
        host: 'billing.localhost',
        state: 'flow/state',
      });

    expect(flowTargetResult.success).toBe(false);
    expect(exchangeRequestResult.success).toBe(false);
  });

  it('keeps platform-owned browser authority cookies host-bound by contract', (): void => {
    expect(compartmentSessionCookieName).toBe('__Host-compartment_session');
    expect(compartmentCliLoginAttemptCookieName).toBe('__Host-compartment_cli_login_attempt');
    expect(compartmentCsrfCookieName).toBe('__Host-compartment_csrf');
    expect(compartmentAppSessionCookieName).toBe('__Host-compartment_app_session');
    expect(readCompartmentAppFlowCookieName('flow')).toBe('__Host-compartment_app_flow_flow');
    expect(compartmentReservedCookieNamePrefixes).toEqual([
      '__Host-compartment_',
      '__Secure-compartment_',
      'compartment_',
    ]);
  });

  it('accepts service access modes in compartment descriptors', (): void => {
    const result: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'internal-tools',
      services: {
        web: {
          accessMode: 'public',
          path: '.',
        },
      },
    });

    expect(result.services.web).toEqual({
      accessMode: 'public',
      path: '.',
    });
  });

  it('rejects app access proxy routes that violate canonical route rule invariants', (): void => {
    const result: SafeParseReturnType<AppAccessStateResponse, AppAccessStateResponse> =
      appAccessStateResponseSchema.safeParse({
        state: {
          grants: [],
          onDemandTlsHosts: [],
          compartmentUrl: 'http://console.example.com',
          routes: [
            {
              accessMode: 'authenticated',
              host: 'smoke-multi-service.example.com',
              organizationId: 'org_123',
              organizationSlug: 'acme-dev',
              proxyRoutes: [
                {
                  on: 'web',
                  path: '/api/*',
                  rewrite: '/ready',
                  stripPrefix: '/api',
                  target: {
                    accessMode: 'authenticated',
                    routeScopeId: 'org_123',
                    routeScopeType: 'organization',
                    scopeChain: [
                      {
                        scopeId: 'org_123',
                        scopeType: 'organization',
                      },
                    ],
                    upstreamHost: 'app-backoffice.cpt-project.svc',
                    upstreamPort: 80,
                  },
                  to: 'backoffice',
                },
              ],
              upstreamHost: 'app-web.cpt-project.svc',
              upstreamPort: 80,
              routeScopeId: 'org_123',
              routeScopeType: 'organization',
              scopeChain: [
                {
                  scopeId: 'org_123',
                  scopeType: 'organization',
                },
              ],
            },
          ],
        },
      });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['state', 'routes', 0, 'proxyRoutes', 0, 'rewrite'],
        }),
      );
    }
  });

  it('accepts edge session invalidation payloads', (): void => {
    const result: EdgeInvalidateAppSessionsRequest = edgeInvalidateAppSessionsRequestSchema.parse({
      authSessionId: 'auth_123',
    });

    expect(result.authSessionId).toBe('auth_123');
  });

  it('builds error response helper with a contract-safe shape', (): void => {
    const errorPayload: ErrorResponsePayload = createErrorResponse('invalid_request', 'Request body is invalid.');

    expect(errorPayload.error.code).toBe('invalid_request');
  });

  it('accepts project show payloads with a missing remote project', (): void => {
    const result: ProjectShowResponse = projectShowResponseSchema.parse({
      descriptorFile: '/tmp/compartment.yml',
      localProjectName: 'smoke-web',
      project: null,
      remoteState: 'not_created',
    });

    expect(result.remoteState).toBe('not_created');
  });

  it('accepts project read payloads with a disconnected remote project', (): void => {
    const result: ProjectReadResponse = projectReadResponseSchema.parse({
      project: {
        archivedAt: null,
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'prj_123',
        name: 'smoke-web',
        organizationId: 'org_123',
        updatedAt: '2026-03-24T10:00:00.000Z',
      },
      remoteState: 'disconnected',
    });

    expect(result.remoteState).toBe('disconnected');
  });

  it('accepts project show payloads with a disconnected remote project', (): void => {
    const result: ProjectShowResponse = projectShowResponseSchema.parse({
      descriptorFile: '/tmp/compartment.yml',
      localProjectName: 'smoke-web',
      project: {
        archivedAt: null,
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'prj_123',
        name: 'smoke-web',
        organizationId: 'org_123',
        updatedAt: '2026-03-24T10:00:00.000Z',
      },
      remoteState: 'disconnected',
    });

    expect(result.remoteState).toBe('disconnected');
  });

  it('accepts deployment payloads with a canonical release image repository', (): void => {
    const result: DeployResponse = deployResponseSchema.parse({
      deploymentRunId: 'drn_123',
      deployments: [
        {
          build: {
            env: [],
            include: [],
            packages: {
              build: [],
              runtime: [],
            },
            strategy: 'auto',
          },
          completedAt: null,
          createdAt: '2026-03-24T09:00:00.000Z',
          failureMessage: null,
          health: 'pending',
          id: 'dep_123',
          isActive: false,
          label: null,
          operation: {
            completedAt: null,
            createdAt: '2026-03-24T09:00:00.000Z',
            id: 'op_123',
            status: 'running',
            targetId: 'dep_123',
            targetType: 'deployment',
            type: 'deployment.create',
          },
          promotionStage: 'building',
          readiness: {
            path: '/healthz',
            timeoutMs: 30000,
            type: 'http',
          },
          rollbackAvailable: false,
          run: {},
          routeUrl: null,
          serviceName: 'web',
          status: 'running',
        },
      ],
      environment: {
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'env_123',
        name: 'production',
        projectId: 'prj_123',
        updatedAt: '2026-03-24T09:00:00.000Z',
      },
      project: {
        archivedAt: null,
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'prj_123',
        name: 'smoke-web',
        organizationId: 'org_123',
        updatedAt: '2026-03-24T09:00:00.000Z',
      },
      resources: [],
    });

    expect(expectPresent(result.deployments[0], 'deployment').serviceName).toBe('web');
  });

  it('rejects deployment payloads without rollback availability', (): void => {
    const result: SafeParseReturnType<DeployResponse, DeployResponse> = deployResponseSchema.safeParse({
      deploymentRunId: 'drn_compat_123',
      deployments: [
        {
          build: {
            env: [],
            include: [],
            packages: {
              build: [],
              runtime: [],
            },
            strategy: 'auto',
          },
          completedAt: '2026-03-24T10:00:00.000Z',
          createdAt: '2026-03-24T09:00:00.000Z',
          failureMessage: null,
          health: 'healthy',
          id: 'dep_compat_123',
          isActive: false,
          label: null,
          operation: {
            completedAt: '2026-03-24T10:00:00.000Z',
            createdAt: '2026-03-24T09:00:00.000Z',
            id: 'op_compat_123',
            status: 'succeeded',
            targetId: 'dep_compat_123',
            targetType: 'deployment',
            type: 'deployment.create',
          },
          promotionStage: 'active',
          readiness: {
            path: '/healthz',
            timeoutMs: 30000,
            type: 'http',
          },
          reusableImageState: 'available',
          run: {},
          routeUrl: 'https://smoke-web.example.com',
          serviceName: 'web',
          status: 'succeeded',
        },
      ],
      environment: {
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'env_compat_123',
        name: 'production',
        projectId: 'prj_compat_123',
        updatedAt: '2026-03-24T09:00:00.000Z',
      },
      project: {
        archivedAt: null,
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'prj_compat_123',
        name: 'smoke-web',
        organizationId: 'org_compat_123',
        updatedAt: '2026-03-24T09:00:00.000Z',
      },
      resources: [],
    });

    expect(result.success).toBe(false);
  });

  it('accepts explicit deployment run logs query selectors', (): void => {
    expect(
      deploymentRunLogsQuerySchema.safeParse({
        projectName: 'smoke-web',
        selector: 'latest',
      }).success,
    ).toBe(true);

    expect(
      deploymentRunLogsQuerySchema.safeParse({
        deploymentRunId: 'drn_123',
        projectName: 'smoke-web',
        selector: 'run',
      }).success,
    ).toBe(true);

    expect(
      deploymentRunLogsQuerySchema.safeParse({
        projectName: 'smoke-web',
      }).success,
    ).toBe(false);

    expect(
      deploymentRunLogsQuerySchema.safeParse({
        deploymentRunId: 'drn_123',
        projectName: 'smoke-web',
        selector: 'latest',
      }).success,
    ).toBe(false);
  });

  it('requires a source upload id in deploy submit requests', (): void => {
    expect(
      deployRequestSchema.safeParse({
        descriptor: {
          name: 'smoke-web',
          services: {
            web: '.',
          },
        },
      }).success,
    ).toBe(false);

    const result: DeployRequest = deployRequestSchema.parse({
      descriptor: {
        name: 'smoke-web',
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    });

    expect(result.sourceUploadId).toBe('sup_123');
  });

  it('accepts deploy submit requests with descriptor resource presets', (): void => {
    const payload: DeployRequestInput = {
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            env: {
              POSTGRES_DB: 'smoke',
            },
            preset: 'postgres',
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    };

    const result: DeployRequest = deployRequestSchema.parse(payload);

    expect(result.descriptor.resources?.db?.image).toBe('postgres:16-alpine');
    expect(result.descriptor.resources?.db?.env?.POSTGRES_DB).toBe('smoke');
    expect(result.descriptor.resources?.db?.generatedVariables?.POSTGRES_PASSWORD).toEqual({
      generator: 'token',
    });
  });

  it('accepts deploy submit requests with generated resource variables', (): void => {
    const payload: DeployRequestInput = {
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            generatedVariables: {
              POSTGRES_PASSWORD: {
                bytes: 32,
                encoding: 'base64url',
                generator: 'token',
              },
            },
            image: 'postgres:16',
            outputs: {
              'connection-url': {
                sensitive: true,
                value: 'postgres://app:${env.POSTGRES_PASSWORD}@${resource.host}:5432/app',
              },
            },
            ports: [5432],
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    };

    const result: DeployRequest = deployRequestSchema.parse(payload);

    expect(result.descriptor.resources?.db?.generatedVariables?.POSTGRES_PASSWORD).toEqual({
      bytes: 32,
      encoding: 'base64url',
      generator: 'token',
    });
  });

  it('rejects deploy submit resource generated variable collisions with literal env', (): void => {
    const result: SafeParseReturnType<DeployRequestInput, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            env: {
              POSTGRES_PASSWORD: 'literal',
            },
            generatedVariables: {
              POSTGRES_PASSWORD: {
                generator: 'token',
              },
            },
            image: 'postgres:16',
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects deploy submit resource generated variable generators outside the supported set', (): void => {
    const result: SafeParseReturnType<DeployRequestInput, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            generatedVariables: {
              POSTGRES_PASSWORD: {
                generator: 'uuid',
              },
            },
            image: 'postgres:16',
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects deploy submit resource generated variable token options outside the supported set', (): void => {
    const result: SafeParseReturnType<DeployRequestInput, DeployRequest> = deployRequestSchema.safeParse({
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            generatedVariables: {
              POSTGRES_PASSWORD: {
                bytes: 8,
                encoding: 'base64',
                generator: 'token',
              },
            },
            image: 'postgres:16',
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    });

    expect(result.success).toBe(false);
  });

  it('keeps literal postgres preset env overrides ahead of generated variables in deploy requests', (): void => {
    const result: DeployRequest = deployRequestSchema.parse({
      descriptor: {
        name: 'smoke-web',
        resources: {
          db: {
            env: {
              POSTGRES_PASSWORD: 'literal-secret',
            },
            preset: 'postgres',
          },
        },
        services: {
          web: '.',
        },
      },
      sourceUploadId: 'sup_123',
    });

    expect(result.descriptor.resources?.db?.env?.POSTGRES_PASSWORD).toBe('literal-secret');
    expect(result.descriptor.resources?.db?.generatedVariables).toBeUndefined();
  });

  it('accepts source upload summaries', (): void => {
    const result: SourceUploadSummary = sourceUploadSummarySchema.parse({
      byteSize: 4096,
      createdAt: '2026-03-24T09:00:00.000Z',
      expiresAt: '2026-03-24T10:00:00.000Z',
      id: 'sup_123',
      sourceDigest: 'sha256:abc123',
    });

    expect(result.id).toBe('sup_123');
  });

  it('accepts project-scoped source upload query parameters', (): void => {
    expect(
      sourceUploadCreateQuerySchema.parse({
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      }),
    ).toEqual({
      environmentName: 'production',
      projectName: 'smoke-web',
      serviceName: 'web',
    });
  });

  it('rejects environment source upload scope without a project', (): void => {
    expect(sourceUploadCreateQuerySchema.safeParse({ environmentName: 'production' }).success).toBe(false);
  });

  it('rejects deployment list payloads without a persisted environment', (): void => {
    const result: SafeParseReturnType<DeploymentListResponse, DeploymentListResponse> =
      deploymentListResponseSchema.safeParse({
        deployments: [buildDeploymentReadSummary()],
        environment: null,
        project: {
          name: 'smoke-web',
        },
      });

    expect(result.success).toBe(false);
  });

  it('accepts readonly-safe deployment status payloads', (): void => {
    const result: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(buildDeploymentStatusResponse());

    expect(expectPresent(result.activeDeployments[0], 'active deployment').serviceName).toBe('web');
  });

  it('rejects deployment status payloads without rollback availability', (): void => {
    const deployment: DeploymentReadSummary = buildDeploymentReadSummary({
      deploymentRunId: 'drn_compat_123',
      id: 'dep_compat_123',
      isActive: false,
      reusableImageState: 'available',
      status: 'succeeded',
    });
    const deploymentWithoutRollback: Partial<DeploymentReadSummary> = { ...deployment };
    delete deploymentWithoutRollback.rollbackAvailable;
    const result: SafeParseReturnType<DeploymentStatusResponse, DeploymentStatusResponse> =
      deploymentStatusResponseSchema.safeParse(
        buildDeploymentStatusResponse({
          activeDeployments: [deploymentWithoutRollback as DeploymentReadSummary],
          deployments: [],
        }),
      );

    expect(result.success).toBe(false);
  });
});
