import type { AccessAssignmentScopeTarget, AccessAssignmentScopeType } from '@compartment/contracts';
import { findEnvironmentByProjectAndName } from '../queries/access-scope.query';
import { findProjectByOrganizationAndName } from '../queries/projects.query';
import { createEnvironmentNotFoundError, createProjectNotFoundError } from '../errors/api-business-error';

interface StoredScopeTarget {
  scopeId: string;
  scopeType: AccessAssignmentScopeType;
}

export async function resolveStoredScopeTarget(
  organizationId: string,
  scope: AccessAssignmentScopeTarget,
): Promise<StoredScopeTarget> {
  switch (scope.scopeType) {
    case 'organization':
      return {
        scopeId: organizationId,
        scopeType: 'organization',
      };
    case 'project':
      return await resolveStoredProjectScopeTarget(organizationId, scope.projectName);
    case 'environment':
      return await resolveStoredEnvironmentScopeTarget(organizationId, scope.projectName, scope.environmentName);
  }
}

async function resolveStoredProjectScopeTarget(
  organizationId: string,
  projectName: string,
): Promise<StoredScopeTarget> {
  const project: { id: string } | undefined = await findProjectByOrganizationAndName(organizationId, projectName);
  if (project === undefined) {
    throw createProjectNotFoundError();
  }

  return {
    scopeId: project.id,
    scopeType: 'project',
  };
}

async function resolveStoredEnvironmentScopeTarget(
  organizationId: string,
  projectName: string,
  environmentName: string,
): Promise<StoredScopeTarget> {
  const environment: { id: string } | undefined = await findEnvironmentByProjectAndName(
    organizationId,
    projectName,
    environmentName,
  );
  if (environment === undefined) {
    throw createEnvironmentNotFoundError();
  }

  return {
    scopeId: environment.id,
    scopeType: 'environment',
  };
}
