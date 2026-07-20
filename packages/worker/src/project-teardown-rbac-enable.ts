import { setTimeout as delay } from 'node:timers/promises';
import {
  AdmissionregistrationV1Api,
  CoreV1Api,
  KubeConfig,
  RbacAuthorizationV1Api,
  type V1ClusterRole,
  type V1Condition,
  type V1NamedRuleWithOperations,
  type V1PolicyRule,
  type V1ValidatingAdmissionPolicy,
  type V1ValidatingAdmissionPolicyBinding,
} from '@kubernetes/client-node';
import { z } from 'zod';

interface ProjectTeardownRbacEnvironment {
  COMPARTMENT_PROJECT_BOOTSTRAP_ADMISSION_POLICY: string;
  COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE: string;
  COMPARTMENT_PROJECT_TEARDOWN_RBAC_BINDING: string;
  COMPARTMENT_PROVISIONING_NAMESPACE: string;
}

interface KubernetesApiError extends Error {
  body?: { code?: number | undefined; message?: string | undefined } | undefined;
}

const environmentSchema: z.ZodType<ProjectTeardownRbacEnvironment> = z.object({
  COMPARTMENT_PROJECT_BOOTSTRAP_ADMISSION_POLICY: z.string().min(1),
  COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE: z.string().min(1),
  COMPARTMENT_PROJECT_TEARDOWN_RBAC_BINDING: z.string().min(1),
  COMPARTMENT_PROVISIONING_NAMESPACE: z.string().min(1),
});

async function main(): Promise<void> {
  const environment: ProjectTeardownRbacEnvironment = environmentSchema.parse(process.env);
  const kubeConfig: KubeConfig = new KubeConfig();
  kubeConfig.loadFromCluster();
  const rbacApi: RbacAuthorizationV1Api = kubeConfig.makeApiClient(RbacAuthorizationV1Api);
  try {
    await waitForProjectTeardownAdmissionGuard(
      kubeConfig.makeApiClient(AdmissionregistrationV1Api),
      environment.COMPARTMENT_PROJECT_BOOTSTRAP_ADMISSION_POLICY,
    );
    await expectNamespaceDeleteDenied(
      kubeConfig.makeApiClient(CoreV1Api),
      environment.COMPARTMENT_PROVISIONING_NAMESPACE,
    );
    await expectProjectRoleEscalationDenied(rbacApi, environment.COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE);
    await enableProjectTeardownRbac(rbacApi, environment.COMPARTMENT_PROJECT_PROVISIONER_CLUSTER_ROLE);
  } catch (error) {
    await removeFailedHookBinding(rbacApi, environment.COMPARTMENT_PROJECT_TEARDOWN_RBAC_BINDING);
    throw error;
  }
}

async function expectProjectRoleEscalationDenied(api: RbacAuthorizationV1Api, roleName: string): Promise<void> {
  const role: V1ClusterRole = await api.readClusterRole({ name: roleName });
  requireNamespaceRule(role).verbs.push('list');
  try {
    await api.replaceClusterRole({ body: role, dryRun: 'All', name: roleName });
  } catch (error) {
    const apiError: KubernetesApiError = error as KubernetesApiError;
    if (
      apiError.body?.message?.includes('Project teardown rollout may change only the canonical namespace rule') === true
    ) {
      return;
    }
    throw error;
  }
  throw new Error('Project teardown admission guard allowed a project provisioner privilege escalation probe.');
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

async function removeFailedHookBinding(api: RbacAuthorizationV1Api, bindingName: string): Promise<void> {
  try {
    await api.deleteClusterRoleBinding({ name: bindingName });
  } catch (error) {
    const apiError: KubernetesApiError = error as KubernetesApiError;
    if (apiError.body?.code !== 404) {
      throw error;
    }
  }
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

async function waitForProjectTeardownAdmissionGuard(api: AdmissionregistrationV1Api, name: string): Promise<void> {
  let consecutiveReadyObservations: number = 0;
  for (let attempt: number = 0; attempt < 60; attempt += 1) {
    const [policy, binding]: [V1ValidatingAdmissionPolicy, V1ValidatingAdmissionPolicyBinding] = await Promise.all([
      api.readValidatingAdmissionPolicy({ name }),
      api.readValidatingAdmissionPolicyBinding({ name }),
    ]);
    consecutiveReadyObservations = isProjectTeardownAdmissionGuardReady(policy, binding, name)
      ? consecutiveReadyObservations + 1
      : 0;
    if (consecutiveReadyObservations >= 2) {
      return;
    }
    await delay(1_000);
  }
  throw new Error('Project teardown admission guard did not become active.');
}

function isProjectTeardownAdmissionGuardReady(
  policy: V1ValidatingAdmissionPolicy,
  binding: V1ValidatingAdmissionPolicyBinding,
  name: string,
): boolean {
  const generation: number | undefined = policy.metadata?.generation;
  return (
    generation !== undefined &&
    policy.status?.observedGeneration === generation &&
    policy.status.conditions?.some(
      (condition: V1Condition): boolean => condition.type === 'Accepted' && condition.status === 'True',
    ) === true &&
    policy.spec?.matchConstraints?.resourceRules?.some(
      (rule: V1NamedRuleWithOperations): boolean =>
        rule.resources?.includes('namespaces') === true && rule.operations?.includes('DELETE') === true,
    ) === true &&
    binding.spec?.policyName === name &&
    binding.spec.validationActions?.includes('Deny') === true
  );
}

async function expectNamespaceDeleteDenied(api: CoreV1Api, namespace: string): Promise<void> {
  try {
    await api.deleteNamespace({ dryRun: 'All', name: namespace });
  } catch (error) {
    const apiError: KubernetesApiError = error as KubernetesApiError;
    if (apiError.body?.message?.includes('Project bootstrap authority is restricted') === true) {
      return;
    }
    throw error;
  }
  throw new Error('Project teardown admission guard allowed an unmanaged namespace deletion probe.');
}

void main();
