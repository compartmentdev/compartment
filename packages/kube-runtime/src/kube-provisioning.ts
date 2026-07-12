import { kubeNamespaceName } from './kube-naming';
import { projectNetworkPolicyManifests } from './kube-network-policy-projection';
import { registryPullSecretManifest } from './kube-secret-projection';
import type { ProjectNamespaceProvisioningRow } from './kube-provisioning.types';
import type { ApplyBundle, KubeManifest } from './kube-runtime.types';

const bootstrapBindingName: string = 'compartment-project-bootstrap';
const controllerName: string = 'compartment-controller';

export function projectNamespaceProvisioningBundle(row: ProjectNamespaceProvisioningRow): ApplyBundle {
  const namespace: string = kubeNamespaceName(row.namespaceId);
  return {
    createBeforeApply: [
      namespaceManifest(row, namespace),
      serviceAccountManifest(namespace),
      roleBindingManifest(namespace),
    ],
    deleteAfterApply: [
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: bootstrapBindingName },
      },
    ],
    objects: [
      registryPullSecretManifest({
        dockerConfigJson: row.registryPullCredentials.dockerConfigJson,
        namespaceId: row.namespaceId,
        secretId: row.registryPullCredentials.secretId,
      }),
      ...projectNetworkPolicyManifests(namespace, row.namespaceId, row.projectId, row.networkPolicy),
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

function serviceAccountManifest(namespace: string): KubeManifest {
  return {
    apiVersion: 'v1',
    automountServiceAccountToken: false,
    kind: 'ServiceAccount',
    metadata: { name: controllerName, namespace },
  };
}

function roleBindingManifest(namespace: string): KubeManifest {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: controllerName, namespace },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: controllerName },
    subjects: [{ kind: 'ServiceAccount', name: controllerName, namespace }],
  };
}
