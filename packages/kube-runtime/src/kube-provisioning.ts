import { kubeNamespaceName, kubeSecretName } from './kube-naming';
import { projectLimitRangeManifest } from './kube-limit-range-projection';
import { projectNetworkPolicyManifests } from './kube-network-policy-projection';
import { projectResourceQuotaManifest } from './kube-resource-quota-projection';
import { registryPullSecretManifest } from './kube-secret-projection';
import type { ProjectNamespaceProvisioningRow, ProjectProvisioningServiceAccount } from './kube-provisioning.types';
import type { ApplyBundle, KubeManifest } from './kube-runtime.types';

const bootstrapBindingName: string = 'compartment-project-bootstrap';
const controllerName: string = 'compartment-controller';

interface ProjectProvisioningBindingSubject {
  kind: 'ServiceAccount';
  name: string;
  namespace: string;
}

export function projectNamespaceProvisioningBundle(row: ProjectNamespaceProvisioningRow): ApplyBundle {
  const namespace: string = kubeNamespaceName(row.namespaceId);
  const projectNamespace: KubeManifest = namespaceManifest(row, namespace);
  return {
    createBeforeApply: [
      projectNamespace,
      roleBindingManifest(bootstrapBindingName, namespace, [row.bootstrapServiceAccount, row.workerServiceAccount]),
    ],
    deleteAfterApply: bootstrapCleanupManifests(namespace),
    objects: [
      projectNamespace,
      registryPullSecretManifest({
        dockerConfigJson: row.registryPullCredentials.dockerConfigJson,
        namespaceId: row.namespaceId,
        secretId: row.registryPullCredentials.secretId,
      }),
      applicationServiceAccountManifest(namespace, row.registryPullCredentials.secretId),
      projectLimitRangeManifest(namespace, row.namespaceId, row.projectId),
      projectResourceQuotaManifest(namespace, row.namespaceId, row.projectId),
      ...projectNetworkPolicyManifests(namespace, row.namespaceId, row.projectId, row.networkPolicy),
      roleBindingManifest(controllerName, namespace, [row.workerServiceAccount]),
    ],
  };
}

function applicationServiceAccountManifest(namespace: string, imagePullSecretId: string): KubeManifest {
  return {
    apiVersion: 'v1',
    automountServiceAccountToken: false,
    imagePullSecrets: [{ name: kubeSecretName(imagePullSecretId) }],
    kind: 'ServiceAccount',
    metadata: { name: namespace, namespace },
  };
}

export function projectNamespaceDeleteTarget(namespaceId: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: kubeNamespaceName(namespaceId) },
  };
}

export function projectNamespaceOrganizationLabelManifest(namespaceId: string, organizationId: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      labels: { 'compartment.dev/organization-id': organizationId },
      name: kubeNamespaceName(namespaceId),
    },
  };
}

function namespaceManifest(row: ProjectNamespaceProvisioningRow, namespace: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      annotations: { 'compartment.dev/project-name': row.projectName },
      labels: {
        'app.kubernetes.io/managed-by': 'compartment',
        'compartment.dev/namespace-id': row.namespaceId,
        'compartment.dev/organization-id': row.organizationId,
        'compartment.dev/project-id': row.projectId,
        'compartment.dev/installation-id': row.installationId,
        'pod-security.kubernetes.io/audit': 'restricted',
        'pod-security.kubernetes.io/audit-version': 'latest',
        'pod-security.kubernetes.io/enforce': 'restricted',
        'pod-security.kubernetes.io/enforce-version': 'latest',
        'pod-security.kubernetes.io/warn': 'restricted',
        'pod-security.kubernetes.io/warn-version': 'latest',
      },
      name: namespace,
    },
  };
}

function roleBindingManifest(
  name: string,
  namespace: string,
  subjects: ProjectProvisioningServiceAccount[],
): KubeManifest {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name, namespace },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: controllerName },
    subjects: subjects.map(
      (subject: ProjectProvisioningServiceAccount): ProjectProvisioningBindingSubject => ({
        kind: 'ServiceAccount',
        name: subject.name,
        namespace: subject.namespace,
      }),
    ),
  };
}

function bootstrapCleanupManifests(namespace: string): KubeManifest[] {
  return [
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: bootstrapBindingName, namespace },
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: bootstrapBindingName },
    },
  ];
}
