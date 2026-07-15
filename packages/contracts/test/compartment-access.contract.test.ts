import { describe, expect, it } from 'vitest';
import {
  readAppAccessRouteAuthorizationContext,
  resolveCompartmentAccess,
  type AppAccessGrantState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteAuthorizationContext,
  type AppAccessRouteState,
  type AppAccessScopeReference,
  type CompartmentAccessScopeType,
  type CompartmentEffectiveAccess,
  type PermissionKey,
} from '../src';

interface ResolveCompartmentAccessCase {
  expected: CompartmentEffectiveAccess | null;
  grants: AppAccessGrantState[];
  name: string;
  requiredPermission: PermissionKey | undefined;
}

describe('resolveCompartmentAccess', (): void => {
  const cases: ResolveCompartmentAccessCase[] = [
    {
      expected: null,
      grants: [],
      name: 'returns null when no grants match the scope chain',
      requiredPermission: 'project.read',
    },
    {
      expected: {
        grantedScopeId: 'org_123',
        grantedScopeType: 'organization',
        permissions: ['deployment.read', 'project.read'],
      } satisfies CompartmentEffectiveAccess,
      grants: [createGrant('organization', 'org_123', ['deployment.read', 'project.read'])],
      name: 'grants access from an exact organization scope',
      requiredPermission: 'project.read',
    },
    {
      expected: {
        grantedScopeId: 'prj_123',
        grantedScopeType: 'project',
        permissions: ['deployment.read', 'deployment.inspect'],
      } satisfies CompartmentEffectiveAccess,
      grants: [createGrant('project', 'prj_123', ['deployment.read', 'deployment.inspect'])],
      name: 'grants access from an exact project scope',
      requiredPermission: 'deployment.inspect',
    },
    {
      expected: {
        grantedScopeId: 'env_123',
        grantedScopeType: 'environment',
        permissions: ['deployment.read', 'app.route.access'],
      } satisfies CompartmentEffectiveAccess,
      grants: [createGrant('environment', 'env_123', ['deployment.read', 'app.route.access'])],
      name: 'grants access from an exact environment scope',
      requiredPermission: 'app.route.access',
    },
    {
      expected: {
        grantedScopeId: 'env_123',
        grantedScopeType: 'environment',
        permissions: ['deployment.read', 'deployment.logs.read'],
      } satisfies CompartmentEffectiveAccess,
      grants: [
        createGrant('environment', 'env_123', ['deployment.read']),
        createGrant('environment', 'env_123', ['deployment.logs.read']),
      ],
      name: 'unions permissions from multiple grants at the same scope',
      requiredPermission: 'deployment.logs.read',
    },
    {
      expected: {
        grantedScopeId: 'env_123',
        grantedScopeType: 'environment',
        permissions: ['deployment.read'],
      } satisfies CompartmentEffectiveAccess,
      grants: [
        createGrant('environment', 'env_123', ['deployment.read']),
        createGrant('environment', 'env_123', ['deployment.read']),
      ],
      name: 'collapses duplicate permissions at the same scope',
      requiredPermission: 'deployment.read',
    },
    {
      expected: null,
      grants: [
        createGrant('environment', 'env_123', ['deployment.read']),
        createGrant('organization', 'org_123', ['deployment.read', 'app.route.access']),
      ],
      name: 'denies access when the nearest granted scope lacks the required permission',
      requiredPermission: 'app.route.access',
    },
    {
      expected: {
        grantedScopeId: 'org_123',
        grantedScopeType: 'organization',
        permissions: ['deployment.read', 'app.route.access'],
      } satisfies CompartmentEffectiveAccess,
      grants: [createGrant('organization', 'org_123', ['deployment.read', 'app.route.access'])],
      name: 'falls back to a broader scope only when no narrower grant exists',
      requiredPermission: 'app.route.access',
    },
    {
      expected: {
        grantedScopeId: 'env_123',
        grantedScopeType: 'environment',
        permissions: ['deployment.read'],
      } satisfies CompartmentEffectiveAccess,
      grants: [
        createGrant('environment', 'env_123', ['deployment.read']),
        createGrant('organization', 'org_123', ['project.read']),
      ],
      name: 'returns the nearest granted scope when no required permission is supplied',
      requiredPermission: undefined,
    },
  ];

  it.each(cases)('$name', ({ expected, grants, requiredPermission }: ResolveCompartmentAccessCase): void => {
    const access: CompartmentEffectiveAccess | null = resolveCompartmentAccess(
      createScopeChain(),
      grants,
      requiredPermission,
    );

    expect(access).toEqual(expected);
  });
});

describe('readAppAccessRouteAuthorizationContext', (): void => {
  it('requires both public source and authenticated target access for matched proxy routes', (): void => {
    const target: AppAccessProxyRouteTargetState = {
      accessMode: 'authenticated',
      routeScopeId: 'env_456',
      routeScopeType: 'environment',
      scopeChain: [
        { scopeId: 'env_456', scopeType: 'environment' },
        { scopeId: 'prj_456', scopeType: 'project' },
        { scopeId: 'org_123', scopeType: 'organization' },
      ],
      upstreamHost: 'app.cpt-project.svc',
      upstreamPort: 3001,
    };

    const context: AppAccessRouteAuthorizationContext = readAppAccessRouteAuthorizationContext(
      createRoute({ accessMode: 'public' }),
      target,
    );

    expect(context.authorizationStates).toEqual([target]);
    expect(context.headerAuthorizationState).toEqual(target);
  });

  it('does not duplicate the same authenticated route authorization state', (): void => {
    const route: AppAccessRouteState = createRoute({ accessMode: 'authenticated' });
    const target: AppAccessProxyRouteTargetState = {
      accessMode: 'authenticated',
      routeScopeId: route.routeScopeId,
      routeScopeType: route.routeScopeType,
      scopeChain: route.scopeChain,
      upstreamHost: 'app.cpt-project.svc',
      upstreamPort: 3001,
    };

    const context: AppAccessRouteAuthorizationContext = readAppAccessRouteAuthorizationContext(route, target);

    expect(context.authorizationStates).toEqual([route]);
    expect(context.headerAuthorizationState).toEqual(route);
  });
});

function createGrant(
  scopeType: CompartmentAccessScopeType,
  scopeId: string,
  permissions: PermissionKey[],
): AppAccessGrantState {
  return {
    permissions,
    principalId: 'prn_123',
    scopeId,
    scopeType,
  };
}

function createScopeChain(): AppAccessScopeReference[] {
  return [
    {
      scopeId: 'env_123',
      scopeType: 'environment',
    },
    {
      scopeId: 'prj_123',
      scopeType: 'project',
    },
    {
      scopeId: 'org_123',
      scopeType: 'organization',
    },
  ];
}

function createRoute(overrides: Partial<AppAccessRouteState> = {}): AppAccessRouteState {
  return {
    accessMode: 'authenticated',
    host: 'billing.localhost',
    organizationId: 'org_123',
    organizationSlug: 'acme-dev',
    proxyRoutes: [],
    routeScopeId: 'env_123',
    routeScopeType: 'environment',
    scopeChain: createScopeChain(),
    upstreamHost: 'app.cpt-project.svc',
    upstreamPort: 3000,
    ...overrides,
  };
}
