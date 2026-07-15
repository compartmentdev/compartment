import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  buildDeploymentKubeReferenceValues,
  type DeploymentKubeReferenceValues,
} from './deployment-kube-reference-values';
import type { UpsertDeploymentKubeReferenceInput } from './deployment-kube-reference.query.types';

export async function upsertDeploymentKubeReference(input: UpsertDeploymentKubeReferenceInput): Promise<void> {
  const now: Date = new Date();
  const values: DeploymentKubeReferenceValues = buildDeploymentKubeReferenceValues(input, now);
  await getApiDatabase()
    .insert(deploymentKubeReferences)
    .values(values)
    .onConflictDoNothing({ target: deploymentKubeReferences.deploymentId });
}
