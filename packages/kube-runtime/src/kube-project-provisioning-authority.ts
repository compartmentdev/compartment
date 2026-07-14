import type { ApplyBundle, KubeManifest } from './kube-runtime.types';
import type { ProjectProvisioningAuthorityInput } from './kube-project-provisioning-authority.types';
import { kubeJobName, kubeSecretName } from './kube-naming';

const bootstrapBindingName: string = 'compartment-project-bootstrap';
const bootstrapRoleName: string = 'compartment-project-bootstrap';

export function projectProvisioningAuthorityBundle(input: ProjectProvisioningAuthorityInput): ApplyBundle {
  return {
    objects: [serviceAccountManifest(input), clusterRoleBindingManifest(input)],
  };
}

export function projectProvisioningAuthorityCleanup(input: ProjectProvisioningAuthorityInput): ApplyBundle {
  return {
    deleteAfterApply: [
      clusterRoleBindingManifest(input),
      serviceAccountManifest(input),
      jobManifest(input),
      jobSecretManifest(input),
    ],
    objects: [],
  };
}

function jobManifest(input: ProjectProvisioningAuthorityInput): KubeManifest {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: kubeJobName(input.jobId), namespace: input.namespace },
  };
}

function jobSecretManifest(input: ProjectProvisioningAuthorityInput): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: kubeSecretName(input.jobId), namespace: input.namespace },
  };
}

function serviceAccountManifest(input: ProjectProvisioningAuthorityInput): KubeManifest {
  return {
    apiVersion: 'v1',
    automountServiceAccountToken: false,
    kind: 'ServiceAccount',
    metadata: { name: input.serviceAccountName, namespace: input.namespace },
  };
}

function clusterRoleBindingManifest(input: ProjectProvisioningAuthorityInput): KubeManifest {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: { name: bootstrapBindingName },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: bootstrapRoleName },
    subjects: [{ kind: 'ServiceAccount', name: input.serviceAccountName, namespace: input.namespace }],
  };
}
