import { sql, type SQL } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';

export function buildDeploymentUpstreamHostExpression(): SQL<string> {
  return sql<string>`${deploymentKubeReferences.serviceName} || '.' || ${deploymentKubeReferences.namespace} || '.svc'`;
}
