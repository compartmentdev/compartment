import {
  resolveCompartmentAccess,
  type AppAccessGrantState,
  type CompartmentEffectiveAccess,
  type PermissionKey,
} from '@compartment/contracts';
import { createForbiddenError } from '../errors/api-business-error';
import { findEnvironmentById, findProjectById } from '../queries/access-scope.query';
import { listOrganizationRowsForPrincipal } from '../queries/organizations.query';
import {
  listDirectPrincipalPermissionGrantRows,
  listDirectPrincipalPermissionGrantRowsWithExecutor,
  listGroupPrincipalPermissionGrantRows,
  listGroupPrincipalPermissionGrantRowsWithExecutor,
} from '../queries/rbac-assignments.query';
import type { PrincipalPermissionGrantRow, RbacTransaction } from '../queries/rbac.query.types';
import { isAuthSessionAllowedForOrganization } from './organization-auth-settings.service';
import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';
import type {
  AccessScopeReference,
  EffectiveAccess,
  PrincipalAccessEvaluationInput,
  PrincipalPermissionGrant,
  RouteScopeResolution,
} from './access-scope.service.types';
import { hasOrganizationAdminPathPermissions } from './rbac-admin-path.service';

export async function requireScopedPermission(
  input: PrincipalAccessEvaluationInput & { permission: PermissionKey },
): Promise<EffectiveAccess> {
  const access: EffectiveAccess | null = await resolveInheritedAccess(input);
  if (access?.permissions.includes(input.permission) !== true) {
    throw createForbiddenError();
  }

  return access;
}

export async function requireAnyGrantedPermission(input: {
  organizationId: string;
  permission: PermissionKey;
  principalId: string;
}): Promise<void> {
  const grants: PrincipalPermissionGrant[] = await listPrincipalPermissionGrants(
    input.organizationId,
    input.principalId,
  );
  if (grants.some((grant: PrincipalPermissionGrant): boolean => grant.permissions.includes(input.permission))) {
    return;
  }

  throw createForbiddenError();
}

export async function requireAnySessionVisibleOrganizationAdminAccess(
  session: AuthSessionOrganizationPolicySession,
): Promise<void> {
  const organizations: { id: string; name: string; slug: string }[] = await listOrganizationRowsForPrincipal(
    session.principalId,
  );
  for (const organization of organizations) {
    const sessionAllowedForOrganization: boolean = await isAuthSessionAllowedForOrganization({
      organizationId: organization.id,
      session,
    });
    if (sessionAllowedForOrganization && (await hasOrganizationAdminGrant(organization.id, session.principalId))) {
      return;
    }
  }

  throw createForbiddenError();
}

export async function resolveInheritedAccess(input: PrincipalAccessEvaluationInput): Promise<EffectiveAccess | null> {
  return await resolveInheritedAccessWithExecutor(input);
}

export async function resolveInheritedAccessWithExecutor(
  input: PrincipalAccessEvaluationInput,
  executor?: RbacTransaction,
): Promise<EffectiveAccess | null> {
  const grants: PrincipalPermissionGrant[] = await listPrincipalPermissionGrants(
    input.organizationId,
    input.principalId,
    executor,
  );

  return await resolveInheritedAccessFromPrincipalGrants(input, grants);
}

export async function resolveInheritedAccessFromPrincipalGrants(
  input: PrincipalAccessEvaluationInput,
  grants: PrincipalPermissionGrant[],
): Promise<EffectiveAccess | null> {
  const routeScopeResolution: RouteScopeResolution = await resolveRouteScopeChain(input.routeScope);
  return resolveInheritedAccessFromScopeChain(routeScopeResolution.scopeChain, grants);
}

export function resolveInheritedAccessFromScopeChain(
  scopeChain: AccessScopeReference[],
  grants: PrincipalPermissionGrant[],
): EffectiveAccess | null {
  const effectiveAccess: CompartmentEffectiveAccess | null = resolveCompartmentAccess(scopeChain, grants);
  if (effectiveAccess === null) {
    return null;
  }

  return {
    grantedScopeId: effectiveAccess.grantedScopeId,
    grantedScopeType: effectiveAccess.grantedScopeType,
    permissions: effectiveAccess.permissions,
  };
}

export async function listPrincipalPermissionGrants(
  organizationId: string,
  principalId: string,
  executor?: RbacTransaction,
): Promise<PrincipalPermissionGrant[]> {
  return [
    ...toPermissionGrantStates(
      executor === undefined
        ? await listDirectPrincipalPermissionGrantRows(organizationId, principalId)
        : await listDirectPrincipalPermissionGrantRowsWithExecutor(executor, organizationId, principalId),
      principalId,
    ),
    ...toPermissionGrantStates(
      executor === undefined
        ? await listGroupPrincipalPermissionGrantRows(organizationId, principalId)
        : await listGroupPrincipalPermissionGrantRowsWithExecutor(executor, organizationId, principalId),
      principalId,
    ),
  ];
}

async function hasOrganizationAdminGrant(organizationId: string, principalId: string): Promise<boolean> {
  const directGrants: PrincipalPermissionGrantRow[] = await listDirectPrincipalPermissionGrantRows(
    organizationId,
    principalId,
  );
  if (hasOrganizationAdminPathGrant(organizationId, directGrants)) {
    return true;
  }

  const groupGrants: PrincipalPermissionGrantRow[] = await listGroupPrincipalPermissionGrantRows(
    organizationId,
    principalId,
  );
  return hasOrganizationAdminPathGrant(organizationId, [...directGrants, ...groupGrants]);
}

function hasOrganizationAdminPathGrant(
  organizationId: string,
  grants: readonly PrincipalPermissionGrantRow[],
): boolean {
  return hasOrganizationAdminPathPermissions(
    grants
      .filter((grant: PrincipalPermissionGrantRow): boolean => isOrganizationScopeGrant(organizationId, grant))
      .map((grant: PrincipalPermissionGrantRow): PermissionKey => grant.permissionKey),
  );
}

function isOrganizationScopeGrant(organizationId: string, grant: PrincipalPermissionGrantRow): boolean {
  return grant.scopeType === 'organization' && grant.scopeId === organizationId;
}

function toPermissionGrantStates(
  rows: readonly {
    permissionKey: PermissionKey;
    scopeId: string;
    scopeType: 'environment' | 'organization' | 'project';
  }[],
  principalId: string,
): PrincipalPermissionGrant[] {
  return rows.map(
    (row: {
      permissionKey: PermissionKey;
      scopeId: string;
      scopeType: 'environment' | 'organization' | 'project';
    }): AppAccessGrantState => ({
      permissions: [row.permissionKey],
      principalId,
      scopeId: row.scopeId,
      scopeType: row.scopeType,
    }),
  );
}

async function resolveRouteScopeChain(routeScope: AccessScopeReference): Promise<RouteScopeResolution> {
  switch (routeScope.scopeType) {
    case 'organization':
      return {
        organizationId: routeScope.scopeId,
        scopeChain: [routeScope],
      };
    case 'project':
      return await buildProjectRouteScopeResolution(routeScope);
    case 'environment':
      return await buildEnvironmentRouteScopeResolution(routeScope);
  }
}

async function buildProjectRouteScopeResolution(routeScope: AccessScopeReference): Promise<RouteScopeResolution> {
  const project: { id: string; organizationId: string } | undefined = await findProjectById(routeScope.scopeId);

  return {
    organizationId: project?.organizationId ?? null,
    scopeChain: [
      routeScope,
      ...(project === undefined ? [] : [{ scopeId: project.organizationId, scopeType: 'organization' as const }]),
    ],
  };
}

async function buildEnvironmentRouteScopeResolution(routeScope: AccessScopeReference): Promise<RouteScopeResolution> {
  const environment: { id: string; projectId: string } | undefined = await findEnvironmentById(routeScope.scopeId);
  const project: { id: string; organizationId: string } | undefined = await readEnvironmentProject(environment);

  return {
    organizationId: project?.organizationId ?? null,
    scopeChain: [
      routeScope,
      ...(environment === undefined ? [] : [{ scopeId: environment.projectId, scopeType: 'project' as const }]),
      ...(project === undefined ? [] : [{ scopeId: project.organizationId, scopeType: 'organization' as const }]),
    ],
  };
}

async function readEnvironmentProject(
  environment: { id: string; projectId: string } | undefined,
): Promise<{ id: string; organizationId: string } | undefined> {
  return environment?.projectId === undefined ? undefined : await findProjectById(environment.projectId);
}
