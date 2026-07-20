import { setTimeout as delay } from 'node:timers/promises';
import {
  CoreV1Api,
  KubeConfig,
  RbacAuthorizationV1Api,
  type V1ClusterRole,
  type V1PolicyRule,
} from '@kubernetes/client-node';
import { z } from 'zod';
import { readKubernetesStatusMessage, type KubernetesApiErrorBody } from './kubernetes-api-error';

interface ProjectTeardownRbacEnvironment {
  COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE: string;
  COMPARTMENT_PROVISIONING_NAMESPACE: string;
}

interface KubernetesApiError extends Error {
  body?: KubernetesApiErrorBody;
}

const environmentSchema: z.ZodType<ProjectTeardownRbacEnvironment> = z.object({
  COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE: z.string().min(1),
  COMPARTMENT_PROVISIONING_NAMESPACE: z.string().min(1),
});

async function main(): Promise<void> {
  const environment: ProjectTeardownRbacEnvironment = environmentSchema.parse(process.env);
  const kubeConfig: KubeConfig = new KubeConfig();
  kubeConfig.loadFromCluster();
  const rbacApi: RbacAuthorizationV1Api = kubeConfig.makeApiClient(RbacAuthorizationV1Api);
  await waitForNamespaceDeleteDenied(
    kubeConfig.makeApiClient(CoreV1Api),
    environment.COMPARTMENT_PROVISIONING_NAMESPACE,
  );
  await enableProjectTeardownRbac(rbacApi, environment.COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE);
}

async function enableProjectTeardownRbac(api: RbacAuthorizationV1Api, roleName: string): Promise<void> {
  const role: V1ClusterRole = await api.readClusterRole({ name: roleName });
  const namespaceRule: V1PolicyRule = requireNamespaceRule(role);
  if (namespaceRule.verbs.includes('delete')) {
    return;
  }
  namespaceRule.verbs.push('delete');
  await api.replaceClusterRole({ body: role, name: roleName });
}

function requireNamespaceRule(role: V1ClusterRole): V1PolicyRule {
  const namespaceRule: V1PolicyRule | undefined = role.rules?.find(
    (rule: V1PolicyRule): boolean =>
      rule.apiGroups?.includes('') === true && rule.resources?.includes('namespaces') === true,
  );
  if (namespaceRule === undefined) {
    throw new Error('Project provisioner ClusterRole has no namespace rule.');
  }
  return namespaceRule;
}

async function waitForNamespaceDeleteDenied(api: CoreV1Api, namespace: string): Promise<void> {
  let consecutiveDenials: number = 0;
  for (let attempt: number = 0; attempt < 60; attempt += 1) {
    consecutiveDenials = (await isNamespaceDeleteDenied(api, namespace)) ? consecutiveDenials + 1 : 0;
    if (consecutiveDenials >= 2) {
      return;
    }
    await delay(1_000);
  }
  throw new Error('Project teardown admission guard did not deny the unmanaged namespace deletion probe.');
}

async function isNamespaceDeleteDenied(api: CoreV1Api, namespace: string): Promise<boolean> {
  try {
    await api.deleteNamespace({ dryRun: 'All', name: namespace });
  } catch (error) {
    const apiError: KubernetesApiError = error as KubernetesApiError;
    if (readKubernetesStatusMessage(apiError.body)?.includes('Project bootstrap authority is restricted') === true) {
      return true;
    }
    throw error;
  }
  return false;
}

void main();
