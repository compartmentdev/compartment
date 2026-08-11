import { sql, type SQL } from 'drizzle-orm';
import type { ProjectProvisioningAction } from '@compartment/contracts';
import { projectKubeProvisioning } from '../db/schema';
import { projectIsolationVersion } from './project-provisioning-policy';
import type { ProjectKubeProvisioningState, ProjectProvisioningClaimRow } from './project-provisioning.query.types';

export function nextProjectProvisioningAttempts(row: typeof projectKubeProvisioning.$inferSelect): SQL {
  if (row.state === 'succeeded') {
    return sql`1`;
  }
  if (row.state === 'running' || row.state === 'teardown_running') {
    return sql`${row.attempts}`;
  }
  return sql`${projectKubeProvisioning.attempts} + 1`;
}

export function projectProvisioningClaim(
  action: ProjectProvisioningAction,
  leaseId: string,
  projectId: string,
  organizationId: string,
  projectName: string,
): ProjectProvisioningClaimRow {
  return {
    action,
    isolationVersion: projectIsolationVersion,
    leaseId,
    namespaceId: projectId,
    organizationId,
    projectId,
    projectName,
  };
}

export function readProjectProvisioningAction(state: ProjectKubeProvisioningState): ProjectProvisioningAction {
  return state.startsWith('teardown_') ? 'teardown' : 'provision';
}
