import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import {
  kubeNamespaceName,
  projectNetworkPolicyManifests,
  type KubeManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { z } from 'zod';
import { projectNetworkPolicy, type ProjectNetworkPolicyEnvironment } from '../project-network-policy';

const networkPolicyEnvironmentSchema: z.ZodType<ProjectNetworkPolicyEnvironment> = z.object({
  COMPARTMENT_EDGE_NAMESPACE: z.string().min(1),
  COMPARTMENT_KUBE_POD_CIDR: z.string().min(1),
  COMPARTMENT_KUBE_SERVICE_CIDR: z.string().min(1),
});

export async function applyProjectNetworkPolicies(
  runtime: KubeRuntime,
  projectId: string,
  ports: ProjectNetworkPolicyPorts,
): Promise<void> {
  await runtime.apply({ objects: projectProjectNetworkPolicyManifests(projectId, ports) });
}

export function projectProjectNetworkPolicyManifests(
  projectId: string,
  ports: ProjectNetworkPolicyPorts,
): KubeManifest[] {
  const environment: ProjectNetworkPolicyEnvironment = networkPolicyEnvironmentSchema.parse(process.env);
  return projectNetworkPolicyManifests(
    kubeNamespaceName(projectId),
    projectId,
    projectId,
    projectNetworkPolicy(environment, ports),
  );
}
