import type { KubernetesOwnedResourceTarget } from './kubernetes-existing-cluster-preflight.service.types';

export type KubernetesPermissionScope = 'cluster' | 'default' | 'install';
export type KubernetesPermissionRequirement = readonly [string, string, KubernetesPermissionScope];
export type KubernetesApiRequirement = readonly [string, readonly string[]];

export const requiredApiResources: readonly KubernetesApiRequirement[] = [
  [
    '/api/v1',
    ['configmaps', 'namespaces', 'nodes', 'persistentvolumeclaims', 'pods', 'secrets', 'services', 'serviceaccounts'],
  ],
  ['/apis/apps/v1', ['daemonsets', 'deployments', 'statefulsets']],
  ['/apis/batch/v1', ['cronjobs', 'jobs']],
  ['/apis/networking.k8s.io/v1', ['ingresses', 'ingressclasses', 'networkpolicies']],
  ['/apis/node.k8s.io/v1', ['runtimeclasses']],
  ['/apis/rbac.authorization.k8s.io/v1', ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings']],
  ['/apis/storage.k8s.io/v1', ['storageclasses']],
  ['/apis/admissionregistration.k8s.io/v1', ['validatingadmissionpolicies', 'validatingadmissionpolicybindings']],
];

export const requiredCertManagerApis: readonly KubernetesApiRequirement[] = [
  ['/apis/cert-manager.io/v1', ['certificates', 'certificaterequests', 'issuers', 'clusterissuers']],
  ['/apis/acme.cert-manager.io/v1', ['orders', 'challenges']],
];

export const requiredPermissions: readonly KubernetesPermissionRequirement[] = [
  ['create', 'namespaces', 'cluster'],
  ['get', 'namespaces', 'cluster'],
  ['get', 'ingressclasses.networking.k8s.io', 'cluster'],
  ['get', 'storageclasses.storage.k8s.io', 'cluster'],
  ['get', 'runtimeclasses.node.k8s.io', 'cluster'],
  ['list', 'nodes', 'cluster'],
  ['*', 'configmaps', 'install'],
  ['*', 'persistentvolumeclaims', 'install'],
  ['*', 'secrets', 'install'],
  ['*', 'services', 'install'],
  ['*', 'serviceaccounts', 'install'],
  ['*', 'daemonsets.apps', 'install'],
  ['*', 'deployments.apps', 'install'],
  ['*', 'statefulsets.apps', 'install'],
  ['*', 'cronjobs.batch', 'install'],
  ['*', 'jobs.batch', 'install'],
  ['*', 'ingresses.networking.k8s.io', 'install'],
  ['*', 'networkpolicies.networking.k8s.io', 'install'],
  ['*', 'certificates.cert-manager.io', 'install'],
  ['*', 'roles.rbac.authorization.k8s.io', 'install'],
  ['*', 'rolebindings.rbac.authorization.k8s.io', 'install'],
  ['*', 'clusterroles.rbac.authorization.k8s.io', 'cluster'],
  ['*', 'clusterrolebindings.rbac.authorization.k8s.io', 'cluster'],
  ['*', 'validatingadmissionpolicies.admissionregistration.k8s.io', 'cluster'],
  ['*', 'validatingadmissionpolicybindings.admissionregistration.k8s.io', 'cluster'],
  ['create', 'certificates.cert-manager.io', 'default'],
  ['get', 'certificates.cert-manager.io', 'default'],
  ['get', 'secrets', 'default'],
  ['create', 'pods', 'default'],
  ['delete', 'pods', 'default'],
  ['get', 'pods', 'default'],
  ['watch', 'pods', 'default'],
  ['create', 'pods/exec', 'default'],
];

export function readClusterOwnedTargets(fullname: string): KubernetesOwnedResourceTarget[] {
  return [
    target('ClusterRole', 'compartment-controller', 'clusterroles.rbac.authorization.k8s.io'),
    target('ClusterRole', 'compartment-project-bootstrap', 'clusterroles.rbac.authorization.k8s.io'),
    target('ClusterRole', `${fullname}-project-provisioner`, 'clusterroles.rbac.authorization.k8s.io'),
    target('ClusterRoleBinding', `${fullname}-project-provisioner`, 'clusterrolebindings.rbac.authorization.k8s.io'),
    target(
      'ValidatingAdmissionPolicy',
      `${fullname}-project-bootstrap-boundary`,
      'validatingadmissionpolicies.admissionregistration.k8s.io',
    ),
    target(
      'ValidatingAdmissionPolicyBinding',
      `${fullname}-project-bootstrap-boundary`,
      'validatingadmissionpolicybindings.admissionregistration.k8s.io',
    ),
  ];
}

function target(kind: string, name: string, resource: string): KubernetesOwnedResourceTarget {
  return { kind, name, resource };
}
