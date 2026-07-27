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
import { kubeLimitRangeName, kubeSecretName } from '../src/kube-naming';

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
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow('prj-01jz'));
    const created: KubeManifest[] = bundle.createBeforeApply ?? [];
    const namespace: KubeManifest = created[0]!;
    const binding: KubeManifest = created[1]!;
    expect(bundle.objects.map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'Secret',
      'LimitRange',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'NetworkPolicy',
      'RoleBinding',
    ]);

    expect(namespace).toMatchObject({ kind: 'Namespace', metadata: { name: kubeNamespaceName('prj-01jz') } });
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
    expect(bundle.objects[0]).toMatchObject({
      kind: 'Secret',
      metadata: {
        labels: { 'compartment.dev/namespace-id': 'prj-01jz' },
        name: kubeSecretName('pull-prj-01jz'),
        namespace: kubeNamespaceName('prj-01jz'),
      },
      stringData: { '.dockerconfigjson': '{"auths":{"registry.example":{"auth":"generated"}}}' },
      type: 'kubernetes.io/dockerconfigjson',
    });
  });

  it('projects container defaults into the namespace lifecycle', (): void => {
    const namespaceId: string = 'prj-01jz';
    const namespaceName: string = kubeNamespaceName(namespaceId);
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow(namespaceId));
    const namespace: KubeManifest = (bundle.createBeforeApply ?? []).find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Namespace',
    )!;
    const limitRange: KubeManifest = bundle.objects.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'LimitRange',
    )!;

    expect(namespace.metadata?.name).toBe(namespaceName);
    expect(limitRange).toEqual({
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
            default: { cpu: '1', memory: '1Gi' },
            defaultRequest: { cpu: '50m', memory: '128Mi' },
            type: 'Container',
          },
        ],
      },
    });
    expect(projectNamespaceDeleteTarget(namespaceId)).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespaceName },
    });
  });

  it('projects the T2 isolation matrix in deterministic policy order', (): void => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle(provisioningRow('prj-01jz'));
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
              from: [
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
              from: [
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
    expect(ruleFor(rules, 'namespaces')).toMatchObject({ verbs: ['get', 'create'] });
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
      'networkpolicies',
    ]) {
      expect(ruleFor(rules, resource)?.verbs).toEqual(['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']);
    }
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
    projectId: namespaceId,
    registryPullCredentials: {
      dockerConfigJson: '{"auths":{"registry.example":{"auth":"generated"}}}',
      secretId: `pull-${namespaceId}`,
    },
    workerServiceAccount: { name: 'compartment-worker', namespace: 'compartment' },
  };
}
