import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deploymentKubeReferences, deployments, projectResources } from '../src/db/schema';
import { readProjectNetworkPolicyPorts } from '../src/queries/network-policy-ports.query';
import {
  createDeploymentKubeReferenceDatabaseTestContext,
  seedCandidate,
  seedDeployment,
  useApiRuntimeDatabaseTestHarness,
} from './deployment-kube-reference.query.db.harness';

const { apiConfig, databaseUrl, db, pool } = createDeploymentKubeReferenceDatabaseTestContext('network_policy_ports');

describe('project NetworkPolicy port desired state', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await seedDeployment(db);
      await db.update(deployments).set({ resolvedPortsJson: '[8080]' }).where(eq(deployments.id, 'dep_kube'));
      await db.insert(projectResources).values({
        commandJson: '[]',
        envJson: '[]',
        environmentId: 'env_kube',
        id: 'res_cache',
        image: 'redis:8',
        name: 'cache',
        portsJson: '[6379,5432]',
        readinessJson: 'null',
        runtimeDefinitionHash: 'cache-runtime',
        status: 'running',
        volumesJson: '[]',
      });
    },
  });

  it('expands and shrinks the namespace union with deployment and resource desired state', async (): Promise<void> => {
    await expect(readProjectNetworkPolicyPorts('prj_kube', null)).resolves.toEqual({
      applicationPorts: [8080],
      resourcePorts: [5432, 6379],
    });

    await seedCandidate(db);
    await db.update(deployments).set({ resolvedPortsJson: '[8080,9090]' }).where(eq(deployments.id, 'dep_candidate'));
    await expect(readProjectNetworkPolicyPorts('prj_kube', null)).resolves.toEqual({
      applicationPorts: [8080, 9090],
      resourcePorts: [5432, 6379],
    });
    await expect(readProjectNetworkPolicyPorts('prj_kube', 'dep_candidate')).resolves.toEqual({
      applicationPorts: [8080],
      resourcePorts: [5432, 6379],
    });

    await db
      .update(deploymentKubeReferences)
      .set({ state: 'stopped' })
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    await db.update(projectResources).set({ status: 'deleting' }).where(eq(projectResources.id, 'res_cache'));
    await expect(readProjectNetworkPolicyPorts('prj_kube', null)).resolves.toEqual({
      applicationPorts: [8080],
      resourcePorts: [],
    });
  });
});
