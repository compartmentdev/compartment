import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAllDocuments } from 'yaml';

const [manifestPath] = process.argv.slice(2);
assert.ok(manifestPath, 'Rendered manifest path is required.');

const manifests = parseAllDocuments(await readFile(manifestPath, 'utf8')).map((document) => document.toJS());
const fullname = 'compartment-compartment';
const provisioningNamespace = `${fullname}-project-provisioning`;

const provisionerClusterRole = requiredManifest('ClusterRole', `${fullname}-project-provisioner`);
const clusterRoleBindingRules = rulesFor(provisionerClusterRole, 'clusterrolebindings');
assert.deepEqual(
  clusterRoleBindingRules.find((rule) => rule.verbs.includes('create')),
  {
    apiGroups: ['rbac.authorization.k8s.io'],
    resources: ['clusterrolebindings'],
    verbs: ['create'],
  },
  'ClusterRoleBinding create must be isolated from name-scoped mutation authority.',
);
assert.deepEqual(
  clusterRoleBindingRules.find((rule) => rule.verbs.includes('delete')),
  {
    apiGroups: ['rbac.authorization.k8s.io'],
    resourceNames: ['compartment-project-bootstrap'],
    resources: ['clusterrolebindings'],
    verbs: ['get', 'update', 'patch', 'delete'],
  },
  'Provisioner may mutate only the fixed bootstrap ClusterRoleBinding.',
);

const bootstrapClusterRole = requiredManifest('ClusterRole', 'compartment-project-bootstrap');
assert.ok(
  rulesFor(bootstrapClusterRole, 'rolebindings').some((rule) => rule.verbs.includes('create')),
  'Bootstrap needs RoleBinding create only behind the admission namespace boundary.',
);
const admissionPolicy = requiredManifest('ValidatingAdmissionPolicy', `${fullname}-project-bootstrap-boundary`);
assert.equal(admissionPolicy.apiVersion, 'admissionregistration.k8s.io/v1');
assert.equal(admissionPolicy.spec?.failurePolicy, 'Fail');
const policySource = JSON.stringify(admissionPolicy.spec);
assert.match(policySource, new RegExp(`system:serviceaccount:${provisioningNamespace}:cpt-`));
assert.match(policySource, /request\.namespace/);
assert.match(policySource, /compartment-controller/);
assert.match(policySource, /compartment-project-bootstrap/);
assert.match(
  policySource,
  new RegExp(`system:serviceaccount:default:${fullname}-project-provisioner`),
  'Permanent provisioner ClusterRoleBinding creates must be admission-confined.',
);
assert.match(policySource, /request\.resource\.resource != 'clusterrolebindings'/);
assert.match(policySource, /object\.subjects\.size\(\) == 1/);
assert.match(policySource, /object\.subjects\.size\(\) == 2/);
assert.match(policySource, new RegExp(`subject\\.name == '${fullname}-worker'`));
assert.match(
  policySource,
  /request\.userInfo\.username == 'system:serviceaccount:' \+ subject\.namespace \+ ':' \+ subject\.name/,
);
requiredManifest('ValidatingAdmissionPolicyBinding', `${fullname}-project-bootstrap-boundary`);

assert.deepEqual(
  rulesFor(bootstrapClusterRole, 'rolebindings').find((rule) =>
    rule.resourceNames?.includes('compartment-project-bootstrap'),
  ),
  {
    apiGroups: ['rbac.authorization.k8s.io'],
    resourceNames: ['compartment-project-bootstrap'],
    resources: ['rolebindings'],
    verbs: ['get', 'delete'],
  },
  'Bootstrap authority must read and delete only its fixed RoleBinding.',
);

requiredManifest('Namespace', provisioningNamespace);
const releaseRole = requiredManifest('Role', `${fullname}-project-provisioner`);
assert.equal(releaseRole.metadata?.namespace, 'default');
assert.equal(rulesFor(releaseRole, 'secrets').length, 0, 'Provisioner must not read platform Secrets.');

const jobRole = requiredManifest('Role', `${fullname}-project-provisioning-job`);
assert.equal(jobRole.metadata?.namespace, provisioningNamespace);
const secretRules = rulesFor(jobRole, 'secrets');
assert.equal(secretRules.length, 1);
assert.deepEqual(secretRules[0]?.verbs, ['get', 'create', 'patch', 'delete']);
assert.ok(!secretRules[0]?.verbs.some((verb) => ['list', 'watch', 'update'].includes(verb)));

function requiredManifest(kind, name) {
  const manifest = manifests.find((candidate) => candidate?.kind === kind && candidate.metadata?.name === name);
  assert.ok(manifest, `${kind}/${name} was not rendered.`);
  return manifest;
}

function rulesFor(manifest, resource) {
  return (manifest.rules ?? []).filter((rule) => rule.resources?.includes(resource));
}
