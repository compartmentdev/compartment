import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments, type Document } from 'yaml';
import { kubeNamespaceName, projectNamespaceProvisioningBundle, type ApplyBundle, type KubeManifest } from '../src';

interface RbacRule {
  apiGroups: string[];
  resourceNames?: string[] | undefined;
  resources: string[];
  verbs: string[];
}

type RbacManifest = KubeManifest & {
  rules?: RbacRule[] | undefined;
};

describe('project namespace bootstrap provisioning', (): void => {
  it('projects the immutable namespace boundary and removes bootstrap authority last', (): void => {
    const bundle: ApplyBundle = projectNamespaceProvisioningBundle({ namespaceId: 'prj-01jz', projectId: 'prj-01jz' });
    const created: KubeManifest[] = bundle.createBeforeApply ?? [];
    const namespace: KubeManifest = created[0]!;
    const serviceAccount: KubeManifest = created[1]!;
    const binding: KubeManifest = created[2]!;
    expect(bundle.objects).toEqual([]);

    expect(namespace).toMatchObject({ kind: 'Namespace', metadata: { name: kubeNamespaceName('prj-01jz') } });
    expect(serviceAccount).toMatchObject({
      automountServiceAccountToken: false,
      kind: 'ServiceAccount',
      metadata: { name: 'compartment-controller', namespace: kubeNamespaceName('prj-01jz') },
    });
    expect(binding).toMatchObject({
      kind: 'RoleBinding',
      metadata: { namespace: kubeNamespaceName('prj-01jz') },
      roleRef: { kind: 'ClusterRole', name: 'compartment-controller' },
      subjects: [{ kind: 'ServiceAccount', name: 'compartment-controller', namespace: kubeNamespaceName('prj-01jz') }],
    });
    expect(bundle.deleteAfterApply).toEqual([
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'compartment-project-bootstrap' },
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
    expect(ruleFor(rules, 'namespaces')).toMatchObject({ verbs: ['create'] });
    expect(ruleFor(rules, 'serviceaccounts')).toMatchObject({ verbs: ['create'] });
    expect(ruleFor(rules, 'roles')).toMatchObject({ verbs: ['create'] });
    expect(ruleFor(rules, 'rolebindings')).toMatchObject({ verbs: ['create'] });
    expect(rules.some((rule: RbacRule): boolean => rule.resources.includes('secrets'))).toBe(false);
    expect(rules.some((rule: RbacRule): boolean => rule.resources.includes('deployments'))).toBe(false);
    expect(rules.some((rule: RbacRule): boolean => rule.resources.includes('clusterrolebindings'))).toBe(false);
    expect(rules.some((rule: RbacRule): boolean => rule.verbs.includes('escalate'))).toBe(false);
  });

  it('keeps controller authority namespaced by RoleBinding and excludes cluster provisioning', (): void => {
    const controller: RbacManifest = manifests('controller-rbac.yaml')[0]!;
    const rules: RbacRule[] = controller.rules ?? [];
    const resources: string[] = rules.flatMap((rule: RbacRule): string[] => rule.resources);
    for (const resource of ['deployments', 'jobs', 'services', 'secrets', 'networkpolicies']) {
      expect(ruleFor(rules, resource)?.verbs).toEqual(['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']);
    }
    expect(ruleFor(rules, 'pods/log')?.verbs).toEqual(['get']);
    expect(resources).not.toContain('namespaces');
    expect(resources).not.toContain('clusterroles');
    expect(resources).not.toContain('clusterrolebindings');
  });
});

function ruleFor(rules: RbacRule[], resource: string): RbacRule | undefined {
  return rules.find((rule: RbacRule): boolean => rule.resources.includes(resource));
}

function manifests(name: string): RbacManifest[] {
  const path: string = resolve(__dirname, '../manifests', name);
  return parseAllDocuments(readFileSync(path, 'utf8')).map(
    (document: Document): RbacManifest => document.toJS() as RbacManifest,
  );
}
