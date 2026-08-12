import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments, type Document } from 'yaml';
import {
  kubeNamespaceName,
  projectNamespaceDeleteTarget,
  projectProvisioningAuthorityBundle,
  projectProvisioningAuthorityCleanup,
  projectNamespaceProvisioningBundle,
  type ApplyBundle,
  type KubeManifest,
  type ProjectNamespaceProvisioningRow,
  type ProjectProvisioningAuthorityInput,
} from '../src';
import { kubeLimitRangeName, kubeResourceQuotaName, kubeSecretName } from '../src/kube-naming';
import { projectResourceConfiguration } from './kube-resource-configuration.test.fixture';
import { serializeManifestOnTheWire } from './kube-transport-audit.harness';

interface RbacRule {
  apiGroups: string[];
  resourceNames?: string[] | undefined;
  resources: string[];
  verbs: string[];
}

const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const privateClassACidr: string = ['10', '0', '0', '0/8'].join('.');
const privateClassBCidr: string = ['172', '16', '0', '0/12'].join('.');
const privateClassCCidr: string = ['192', '168', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

type RbacManifest = KubeManifest & {
  rules?: RbacRule[] | undefined;
};

describe('project namespace bootstrap provisioning', (): void => {
  it('projects bootstrap identity only for one Job and removes every credential-bearing object', (): void => {
    const input: ProjectProvisioningAuthorityInput = {
      jobId: 'project-provision-prj-01jz',
      namespace: 'compartment-project-provisioning',
      serviceAccountName: kubeNamespaceName('prj-01jz'),
    };
    const authority: ApplyBundle = projectProvisioningAuthorityBundle(input);
    const cleanup: ApplyBundle = projectProvisioningAuthorityCleanup(input);

    expect(authority.objects.map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'ServiceAccount',
      'ClusterRoleBinding',
    ]);
    expect(cleanup.deleteAfterApply?.map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'ClusterRoleBinding',
      'ServiceAccount',
      'Job',
      'Secret',
    ]);
    expect(manifests('bootstrap-rbac.yaml').map((manifest: RbacManifest): string => manifest.kind)).toEqual([
      'ClusterRole',
    ]);
  });

  it('projects the immutable namespace boundary and removes bootstrap authority last', (): void => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(
      provisioningRow('prj-01jz'),
      projectResourceConfiguration,
    );
    const created: KubeManifest[] = bundle.createBeforeApply ?? [];
    const namespace: KubeManifest = created[0]!;
    const binding: KubeManifest = created[1]!;
    expect(bundle.objects.map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'Namespace',
      'Secret',
      'ServiceAccount',
      'LimitRange',
      'ResourceQuota',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'RoleBinding',
    ]);

    expect(namespace).toMatchObject({
      kind: 'Namespace',
      metadata: {
        annotations: { 'compartment.dev/project-name': 'payments' },
        labels: { 'compartment.dev/installation-id': 'inst_1' },
        name: kubeNamespaceName('prj-01jz'),
      },
    });
    expect(binding).toMatchObject({
      kind: 'RoleBinding',
      metadata: { name: 'compartment-project-bootstrap', namespace: kubeNamespaceName('prj-01jz') },
      roleRef: { kind: 'ClusterRole', name: 'compartment-controller' },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: kubeNamespaceName('prj-01jz'),
          namespace: 'compartment-project-provisioning',
        },
        { kind: 'ServiceAccount', name: 'compartment-worker', namespace: 'compartment' },
      ],
    });
    expect(bundle.objects.at(-1)).toMatchObject({
      kind: 'RoleBinding',
      subjects: [{ kind: 'ServiceAccount', name: 'compartment-worker', namespace: 'compartment' }],
    });
    expect(bundle.deleteAfterApply).toEqual([
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'compartment-project-bootstrap', namespace: kubeNamespaceName('prj-01jz') },
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'compartment-project-bootstrap' },
      },
    ]);
    expect(bundle.objects[1]).toMatchObject({
      kind: 'Secret',
      metadata: {
        labels: { 'compartment.dev/namespace-id': 'prj-01jz' },
        name: kubeSecretName('pull-prj-01jz'),
        namespace: kubeNamespaceName('prj-01jz'),
      },
      stringData: { '.dockerconfigjson': '{"auths":{"registry.example":{"auth":"generated"}}}' },
      type: 'kubernetes.io/dockerconfigjson',
    });
    expect(bundle.objects[2]).toMatchObject({
      automountServiceAccountToken: false,
      imagePullSecrets: [{ name: kubeSecretName('pull-prj-01jz') }],
      kind: 'ServiceAccount',
      metadata: {
        name: kubeNamespaceName('prj-01jz'),
        namespace: kubeNamespaceName('prj-01jz'),
      },
    });
  });

  it('projects restricted Pod Security and compute, storage, and object quotas into the namespace lifecycle', async (): Promise<void> => {
    const namespaceId: string = 'prj-01jz';
    const namespaceName: string = kubeNamespaceName(namespaceId);
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(
      provisioningRow(namespaceId),
      projectResourceConfiguration,
    );
    const namespace: KubeManifest = (bundle.createBeforeApply ?? []).find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Namespace',
    )!;
    const limitRange: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'LimitRange',
    )!;
    const resourceQuota: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'ResourceQuota',
    )!;

    expect(namespace.metadata?.name).toBe(namespaceName);
    expect(namespace.metadata?.labels).toMatchObject({
      'compartment.dev/organization-id': 'org_1',
      'pod-security.kubernetes.io/audit': 'restricted',
      'pod-security.kubernetes.io/enforce': 'restricted',
      'pod-security.kubernetes.io/warn': 'restricted',
    });
    expect(await serializeManifestOnTheWire(limitRange)).toEqual({
      apiVersion: 'v1',
      kind: 'LimitRange',
      metadata: {
        labels: {
          'app.kubernetes.io/managed-by': 'compartment',
          'compartment.dev/namespace-id': namespaceId,
          'compartment.dev/project-id': namespaceId,
        },
        name: kubeLimitRangeName(namespaceId),
        namespace: namespaceName,
      },
      spec: {
        limits: [
          {
            default: { cpu: '1', memory: '512Mi' },
            defaultRequest: { cpu: '50m', memory: '512Mi' },
            type: 'Container',
          },
        ],
      },
    });
    expect(await serializeManifestOnTheWire(resourceQuota)).toEqual({
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: {
        labels: {
          'app.kubernetes.io/managed-by': 'compartment',
          'compartment.dev/namespace-id': namespaceId,
          'compartment.dev/project-id': namespaceId,
        },
        name: kubeResourceQuotaName(namespaceId),
        namespace: namespaceName,
      },
      spec: {
        hard: {
          'count/configmaps': '100',
          'count/deployments.apps': '50',
          'count/jobs.batch': '100',
          'count/networkpolicies.networking.k8s.io': '20',
          'count/persistentvolumeclaims': '20',
          'count/secrets': '100',
          'count/serviceaccounts': '10',
          'count/services': '50',
          'limits.cpu': '8',
          'limits.memory': '8Gi',
          pods: '50',
          'requests.cpu': '2',
          'requests.memory': '8Gi',
          'requests.storage': '20Gi',
        },
      },
    });
    expect(projectNamespaceDeleteTarget(namespaceId)).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespaceName },
    });
  });

  it('projects operator overrides without changing object counters', async (): Promise<void> => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow('prj-overridden'), {
      containerDefaults: {
        limit: { cpu: '750m', memory: '768Mi' },
        request: { cpu: '75m', memory: '384Mi' },
      },
      quota: {
        limitsCpu: '12',
        limitsMemory: '12Gi',
        requestsCpu: '3',
        requestsMemory: '3Gi',
        requestsStorage: '30Gi',
      },
    });
    const limitRange: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'LimitRange',
    )!;
    const quota: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'ResourceQuota',
    )!;

    expect(await serializeManifestOnTheWire(limitRange)).toMatchObject({
      spec: {
        limits: [{ default: { cpu: '750m', memory: '768Mi' }, defaultRequest: { cpu: '75m', memory: '384Mi' } }],
      },
    });
    expect(await serializeManifestOnTheWire(quota)).toMatchObject({
      spec: {
        hard: {
          'count/services': '50',
          'limits.cpu': '12',
          'requests.memory': '3Gi',
          'requests.storage': '30Gi',
        },
      },
    });
  });

  it('projects the T2 isolation matrix in deterministic policy order', (): void => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(
      provisioningRow('prj-01jz'),
      projectResourceConfiguration,
    );
    const networkPolicies: KubeManifest[] = bundle.objects.filter(
      (manifest: KubeManifest): boolean => manifest.kind === 'NetworkPolicy',
    );

    expect(networkPolicies).toMatchObject([
      { spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] } },
      {
        spec: {
          egress: [
            {
              ports: [{ port: 5432, protocol: 'TCP' }],
              to: [{ podSelector: { matchLabels: { app: 'resource' } } }],
            },
            {
              ports: [
                { port: 53, protocol: 'UDP' },
                { port: 53, protocol: 'TCP' },
              ],
              to: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
                  podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
                },
              ],
            },
            {
              to: [
                {
                  ipBlock: {
                    cidr: '0.0.0.0/0',
                    except: [
                      metadataServiceCidr,
                      linkLocalCidr,
                      privateClassACidr,
                      privateClassBCidr,
                      privateClassCCidr,
                      podCidr,
                      serviceCidr,
                    ],
                  },
                },
              ],
            },
          ],
          podSelector: { matchLabels: { app: 'application' } },
        },
      },
      {
        spec: {
          egress: [
            {
              ports: [{ port: 5432, protocol: 'TCP' }],
              to: [{ podSelector: { matchLabels: { app: 'resource' } } }],
            },
            {
              ports: [
                { port: 53, protocol: 'UDP' },
                { port: 53, protocol: 'TCP' },
              ],
              to: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
                  podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
                },
              ],
            },
            {
              to: [
                {
                  ipBlock: {
                    cidr: '0.0.0.0/0',
                    except: [
                      metadataServiceCidr,
                      linkLocalCidr,
                      privateClassACidr,
                      privateClassBCidr,
                      privateClassCCidr,
                      podCidr,
                      serviceCidr,
                    ],
                  },
                },
              ],
            },
          ],
          podSelector: {
            matchExpressions: [{ key: 'compartment.dev/job-class', operator: 'Exists' }],
          },
        },
      },
      {
        spec: {
          ingress: [
            {
              _from: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'platform-01jz' } },
                  podSelector: { matchLabels: { 'app.kubernetes.io/name': 'caddy' } },
                },
              ],
              ports: [{ port: 8080, protocol: 'TCP' }],
            },
          ],
        },
      },
      {
        spec: {
          ingress: [
            {
              _from: [
                { podSelector: { matchLabels: { app: 'application' } } },
                {
                  podSelector: {
                    matchExpressions: [{ key: 'compartment.dev/job-class', operator: 'Exists' }],
                  },
                },
              ],
              ports: [{ port: 5432, protocol: 'TCP' }],
            },
          ],
          podSelector: { matchLabels: { app: 'resource' } },
        },
      },
    ]);
  });

  it('keeps bootstrap unable to read Secrets or workloads and restricts bind to the controller role', (): void => {
    const bootstrap: RbacManifest = manifests('bootstrap-rbac.yaml').find(
      (manifest: RbacManifest): boolean => manifest.kind === 'ClusterRole',
    )!;
    const rules: RbacRule[] = bootstrap.rules ?? [];
    const bind: RbacRule = rules.find((rule: RbacRule): boolean => rule.verbs.includes('bind'))!;

    expect(bind).toMatchObject({
      resourceNames: ['compartment-controller'],
      resources: ['clusterroles'],
      verbs: ['bind'],
    });
    expect(ruleFor(rules, 'namespaces')).toMatchObject({ verbs: ['get', 'create', 'update', 'patch'] });
    expect(ruleFor(rules, 'rolebindings')).toMatchObject({ verbs: ['create'] });
    expect(ruleFor(rules, 'serviceaccounts')).toBeUndefined();
    expect(ruleFor(rules, 'roles')).toBeUndefined();
    expect(rules.some((rule: RbacRule): boolean => rule.resources.includes('secrets'))).toBe(false);
    expect(rules.some((rule: RbacRule): boolean => rule.resources.includes('deployments'))).toBe(false);
    expect(ruleFor(rules, 'clusterrolebindings')).toMatchObject({
      resourceNames: ['compartment-project-bootstrap'],
      verbs: ['delete'],
    });
    expect(ruleFor(rules, 'rolebindings')?.verbs).toEqual(['create']);
    expect(
      rules.find(
        (rule: RbacRule): boolean =>
          rule.resources.includes('rolebindings') &&
          rule.resourceNames?.includes('compartment-project-bootstrap') === true,
      ),
    ).toMatchObject({ verbs: ['get', 'delete'] });
    expect(rules.some((rule: RbacRule): boolean => rule.verbs.includes('escalate'))).toBe(false);
  });

  it('grants Kubernetes roles only to explicit component ServiceAccounts', (): void => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(
      provisioningRow('prj-rbac'),
      projectResourceConfiguration,
    );
    const bindings: KubeManifest[] = [...(bundle.createBeforeApply ?? []), ...bundle.objects].filter(
      (manifest: KubeManifest): boolean => manifest.kind === 'RoleBinding' || manifest.kind === 'ClusterRoleBinding',
    );

    expect(bindings).not.toHaveLength(0);
    expect(bindings.every((binding: KubeManifest): boolean => (binding.subjects?.length ?? 0) > 0)).toBe(true);
    expect(JSON.stringify(bindings)).not.toMatch(/"kind":"(?:User|Group)"/u);
  });

  it('keeps controller authority namespaced by RoleBinding and excludes cluster provisioning', (): void => {
    const controller: RbacManifest = manifests('controller-rbac.yaml')[0]!;
    const rules: RbacRule[] = controller.rules ?? [];
    const resources: string[] = rules.flatMap((rule: RbacRule): string[] => rule.resources);
    for (const resource of [
      'deployments',
      'jobs',
      'services',
      'secrets',
      'persistentvolumeclaims',
      'limitranges',
      'resourcequotas',
      'networkpolicies',
    ]) {
      expect(ruleFor(rules, resource)?.verbs).toEqual(['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']);
    }
    expect(ruleFor(rules, 'replicasets', 'apps')?.verbs).toEqual(['get', 'list', 'watch', 'delete']);
    expect(ruleFor(rules, 'pods/log')?.verbs).toEqual(['get']);
    expect(ruleFor(rules, 'pods', 'metrics.k8s.io')?.verbs).toEqual(['get', 'list']);
    expect(resources).not.toContain('namespaces');
    expect(resources).not.toContain('clusterroles');
    expect(resources).not.toContain('clusterrolebindings');
  });
});

function ruleFor(rules: RbacRule[], resource: string, apiGroup?: string): RbacRule | undefined {
  return rules.find(
    (rule: RbacRule): boolean =>
      rule.resources.includes(resource) && (apiGroup === undefined || rule.apiGroups.includes(apiGroup)),
  );
}

function manifests(name: string): RbacManifest[] {
  const path: string = resolve(__dirname, '../manifests', name);
  return parseAllDocuments(readFileSync(path, 'utf8')).map(
    (document: Document): RbacManifest => document.toJS() as RbacManifest,
  );
}

function provisioningRow(namespaceId: string): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: {
      name: kubeNamespaceName(namespaceId),
      namespace: 'compartment-project-provisioning',
    },
    installationId: 'inst_1',
    namespaceId,
    networkPolicy: {
      applicationPodLabels: { app: 'application' },
      applicationPorts: [8080],
      edgeNamespaceName: 'platform-01jz',
      edgePodLabels: { 'app.kubernetes.io/name': 'caddy' },
      podCidr,
      resourcePodLabels: { app: 'resource' },
      resourcePorts: [5432],
      serviceCidr,
    },
    organizationId: 'org_1',
    projectId: namespaceId,
    projectName: 'payments',
    registryPullCredentials: {
      dockerConfigJson: '{"auths":{"registry.example":{"auth":"generated"}}}',
      secretId: `pull-${namespaceId}`,
    },
    workerServiceAccount: { name: 'compartment-worker', namespace: 'compartment' },
  };
}
