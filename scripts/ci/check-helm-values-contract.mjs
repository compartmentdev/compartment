import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const chartDirectory = 'deploy/chart/compartment';
const chartSchemaPath = `${chartDirectory}/values.schema.json`;
const chartSourceDirectories = ['templates', 'files'];
const helpersSourcePath = join('templates', '_helpers.tpl');
const maximumSchemaDepth = 12;

const valuesReadPattern = /\.Values((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/gu;
const digValuesReadPattern = /\bdig\s+((?:"[^"]+"\s+)+)\.Values((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/gu;
const installStateReadPattern =
  /\$(?:installState\.)?(?:effective|persisted)\.([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)*)/gu;
const installStateFieldsPattern =
  /\{\{-\s*define\s+"compartment\.installStateFields"\s*-\}\}(?<body>[\s\S]*?)\{\{-\s*end\s*\}\}/u;

// `compartment.resolvedInstallState` rebuilds a few values sections under its own names, and the
// templates then read the rebuilt names instead of `.Values`. A read through one of these names is a
// read of the mapped values section, so keep the alias table in sync with that helper.
const installStateSectionPaths = new Map([
  ['ingress', 'ingress'],
  ['ingressEndpoint', 'ingress.endpoint'],
  ['platform', 'platform'],
  ['registry', 'registry'],
  ['registryIssuerRef', 'registry.issuerRef'],
  ['secrets', 'secrets'],
]);

// templates/pdb.yaml resolves replica counts with `get $.Values $component` over a literal component
// list, which no static scan can follow. Keep the reads that loop performs explicit.
const dynamicComponentReads = new Map([
  ['api.replicas', 'templates/pdb.yaml'],
  ['caddy.replicas', 'templates/pdb.yaml'],
  ['edge.replicas', 'templates/pdb.yaml'],
  ['projectProvisioner.replicas', 'templates/pdb.yaml'],
  ['worker.replicas', 'templates/pdb.yaml'],
]);

export function main() {
  const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
  const templateReads = readChartValueReads(join(repositoryRoot, chartDirectory));
  const schema = JSON.parse(readFileSync(join(repositoryRoot, chartSchemaPath), 'utf8'));
  const violations = findValuesContractViolations(templateReads, schema);

  if (violations.length > 0) {
    throw new Error(`Helm values contract gate failed:\n${violations.join('\n')}`);
  }

  process.stdout.write(
    `Helm values contract gate passed: ${templateReads.size.toString()} chart value reads all declared in ${chartSchemaPath}.\n`,
  );
}

export function findValuesContractViolations(templateReads, schema) {
  const { declaredPaths, freeFormPaths } = listSchemaValuePaths(schema);
  const readPaths = [...templateReads.keys()].toSorted();

  return [
    ...readPaths
      .filter((path) => !declaredPaths.has(path) && !hasFreeFormAncestor(path, freeFormPaths))
      .map(
        (path) =>
          `${[...templateReads.get(path)].toSorted().join(', ')}: reads .Values.${path}, which ${chartSchemaPath} does not declare`,
      ),
    ...[...declaredPaths]
      .toSorted()
      .filter((path) => !readPaths.some((readPath) => arePathsRelated(readPath, path)))
      .map((path) => `${chartSchemaPath}: declares ${path}, which no chart template or file reads`),
  ];
}

export function readChartValueReads(chartRoot) {
  const reads = new Map();
  for (const [path, source] of dynamicComponentReads) {
    addValueRead(reads, path, `${chartDirectory}/${source}`);
  }
  for (const path of readChartDependencyValuePaths(readFileSync(join(chartRoot, 'Chart.yaml'), 'utf8'))) {
    addValueRead(reads, path, `${chartDirectory}/Chart.yaml`);
  }
  for (const sourcePath of listChartSourcePaths(chartRoot)) {
    const source = readFileSync(join(chartRoot, sourcePath), 'utf8');
    const displayPath = `${chartDirectory}/${sourcePath}`;
    const paths =
      sourcePath === helpersSourcePath
        ? [...readSourceValuePaths(source), ...readInstallStateFieldPaths(source)]
        : readSourceValuePaths(source);
    for (const path of paths) {
      addValueRead(reads, path, displayPath);
    }
  }
  return reads;
}

export function readChartDependencyValuePaths(chartSource) {
  return (parse(chartSource).dependencies ?? []).map((dependency) => dependency.alias ?? dependency.name);
}

export function readSourceValuePaths(source) {
  return [
    ...[...source.matchAll(valuesReadPattern)].map(([, path]) => path.slice(1)),
    ...[...source.matchAll(digValuesReadPattern)].map(([, keys, path]) => readDigValuePath(keys, path)),
    ...[...source.matchAll(installStateReadPattern)].map(([, section, keys]) =>
      readInstallStateValuePath(section, keys),
    ),
  ];
}

function readDigValuePath(quotedKeys, path) {
  // `dig "a" "b" <default> .Values.section` reads section.a.b; the final quoted argument is the default.
  const keys = [...quotedKeys.matchAll(/"([^"]+)"/gu)].map(([, key]) => key);
  return [path.slice(1), ...keys.slice(0, -1)].join('.');
}

function readInstallStateValuePath(section, keys) {
  const sectionPath = installStateSectionPaths.get(section);
  if (sectionPath === undefined) {
    throw new Error(
      `Install state section "${section}" has no values path. Update installStateSectionPaths after changing compartment.resolvedInstallState.`,
    );
  }
  return `${sectionPath}${keys}`;
}

export function readInstallStateFieldPaths(helpersSource) {
  const body = installStateFieldsPattern.exec(helpersSource)?.groups?.body;
  if (body === undefined) {
    throw new Error('templates/_helpers.tpl no longer defines compartment.installStateFields.');
  }
  return parse(body).map((field) => readInstallStateValuePath(field.valuesSection, `.${field.valueKey}`));
}

function addValueRead(reads, path, sourcePath) {
  const sources = reads.get(path) ?? new Set();
  sources.add(sourcePath);
  reads.set(path, sources);
}

function listChartSourcePaths(chartRoot) {
  return chartSourceDirectories.flatMap((directory) =>
    readdirSync(join(chartRoot, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(chartRoot, join(entry.parentPath, entry.name))),
  );
}

export function listSchemaValuePaths(schema) {
  const declaredPaths = new Set();
  const freeFormPaths = new Set();
  collectSchemaValuePaths(schema, '', schema, { declaredPaths, freeFormPaths, depth: 0 });
  return { declaredPaths, freeFormPaths };
}

function collectSchemaValuePaths(node, path, rootSchema, state) {
  const resolved = resolveSchemaReference(node, rootSchema);
  if (typeof resolved !== 'object' || resolved === null) {
    return;
  }
  if (state.depth > maximumSchemaDepth) {
    throw new Error(`Schema nesting below ${path} exceeds ${maximumSchemaDepth.toString()} levels.`);
  }
  if (typeof resolved.additionalProperties === 'object' && resolved.additionalProperties !== null) {
    // Label/annotation-style dictionaries type their values but accept any key.
    state.freeFormPaths.add(path);
  }
  for (const [name, child] of Object.entries(resolved.properties ?? {})) {
    // A `false` subschema forbids a key instead of declaring one.
    if (typeof child !== 'boolean') {
      const childPath = path === '' ? name : `${path}.${name}`;
      state.declaredPaths.add(childPath);
      collectSchemaValuePaths(child, childPath, rootSchema, { ...state, depth: state.depth + 1 });
    }
  }
  // Conditional branches constrain the same path. Array `items` stay opaque: templates render whole
  // arrays, so element fields are never read as values paths.
  for (const branch of listSchemaBranches(resolved)) {
    collectSchemaValuePaths(branch, path, rootSchema, { ...state, depth: state.depth + 1 });
  }
}

function listSchemaBranches(node) {
  return [
    ...(node.allOf ?? []),
    ...(node.anyOf ?? []),
    ...(node.oneOf ?? []),
    ...[node.if, node.then, node.else, node.not].filter((branch) => branch !== undefined),
  ];
}

function resolveSchemaReference(node, rootSchema) {
  if (typeof node !== 'object' || node === null || typeof node.$ref !== 'string') {
    return node;
  }
  const definition = /^#\/definitions\/(?<name>[A-Za-z0-9_]+)$/u.exec(node.$ref)?.groups?.name;
  if (definition === undefined || rootSchema.definitions?.[definition] === undefined) {
    throw new Error(`Unsupported schema reference ${node.$ref}.`);
  }
  return rootSchema.definitions[definition];
}

function hasFreeFormAncestor(path, freeFormPaths) {
  return [...freeFormPaths].some((freeFormPath) => path.startsWith(`${freeFormPath}.`));
}

function arePathsRelated(left, right) {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

runMain(import.meta.url, process.argv[1], main);
