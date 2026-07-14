import { kubeNamespaceName } from './kube-naming';
import { projectNetworkPolicyManifests } from './kube-network-policy-projection';
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
  return {
    createBeforeApply: [
      namespaceManifest(row, namespace),
      roleBindingManifest(bootstrapBindingName, namespace, [row.bootstrapServiceAccount, row.workerServiceAccount]),
    ],
    deleteAfterApply: bootstrapCleanupManifests(namespace),
    objects: [
      registryPullSecretManifest({
        dockerConfigJson: row.registryPullCredentials.dockerConfigJson,
        namespaceId: row.namespaceId,
        secretId: row.registryPullCredentials.secretId,
      }),
      ...projectNetworkPolicyManifests(namespace, row.namespaceId, row.projectId, row.networkPolicy),
      roleBindingManifest(controllerName, namespace, [row.workerServiceAccount]),
    ],
  };
}

function namespaceManifest(row: ProjectNamespaceProvisioningRow, namespace: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      labels: {
        'app.kubernetes.io/managed-by': 'compartment',
        'compartment.dev/namespace-id': row.namespaceId,
        'compartment.dev/project-id': row.projectId,
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
