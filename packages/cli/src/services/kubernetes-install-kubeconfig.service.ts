import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { JsonValue } from '@compartment/utils';
import { parse } from 'yaml';
import { absolutizeKubeconfigFileReferences, mergeKubeconfigDocuments } from './kubernetes-kubeconfig-merge.support';
import type {
  KubernetesKubeconfigCandidate,
  KubernetesKubeconfigCandidateResult,
  KubernetesKubeconfigDocument,
  KubernetesKubeconfigResolutionInput,
  ResolvedKubernetesKubeconfig,
} from './kubernetes-install-kubeconfig.service.types';

interface ConfiguredKubeconfigReadResult {
  checked: string[];
  documents: KubernetesKubeconfigDocument[];
}

const defaultK3sKubeconfigPath: string = '/etc/rancher/k3s/k3s.yaml';

export async function resolveKubernetesInstallKubeconfig(
  input: KubernetesKubeconfigResolutionInput = { env: process.env, homeDirectory: homedir() },
): Promise<ResolvedKubernetesKubeconfig> {
  if (input.env.KUBECONFIG !== undefined) {
    return await resolveConfiguredKubeconfig(input.env.KUBECONFIG, input.contextName);
  }
  const candidates: KubernetesKubeconfigCandidate[] = buildDefaultCandidates(input);
  const checked: string[] = [];
  let requestedContextFound: boolean = false;
  for (const candidate of candidates) {
    const result: KubernetesKubeconfigCandidateResult = await readKubeconfigCandidate(candidate, input.contextName);
    if (result.resolved !== null) {
      return result.resolved;
    }
    requestedContextFound ||= hasRequestedContext(result.document, input.contextName);
    checked.push(formatCheckedCandidate(candidate, result.reason));
  }
  throw new Error(buildMissingKubeconfigMessage(checked, input.contextName, false, !requestedContextFound));
}

async function resolveConfiguredKubeconfig(
  environmentValue: string,
  contextName: string | undefined,
): Promise<ResolvedKubernetesKubeconfig> {
  const paths: string[] = environmentValue.split(delimiter).filter((path: string): boolean => path !== '');
  assertConfiguredPaths(paths);
  const readResult: ConfiguredKubeconfigReadResult = await readConfiguredKubeconfigs(paths, contextName);
  const merged: KubernetesKubeconfigDocument = mergeKubeconfigDocuments(readResult.documents);
  const resolved: ResolvedKubernetesKubeconfig = requireResolvedKubeconfig(
    merged,
    paths[0] ?? '',
    contextName,
    readResult.checked,
  );
  return paths.length === 1 ? resolved : await materializeMergedKubeconfig(merged, resolved);
}

async function readConfiguredKubeconfigs(
  paths: readonly string[],
  contextName: string | undefined,
): Promise<ConfiguredKubeconfigReadResult> {
  const documents: KubernetesKubeconfigDocument[] = [];
  const checked: string[] = [];
  for (const path of paths) {
    const candidate: KubernetesKubeconfigCandidate = { configured: true, displayPath: path, path };
    const result: KubernetesKubeconfigCandidateResult = await readKubeconfigCandidate(candidate, contextName);
    checked.push(formatCheckedCandidate(candidate, result.reason));
    if (result.document !== null) {
      documents.push(absolutizeKubeconfigFileReferences(result.document, dirname(path)));
    }
  }
  return { checked, documents };
}

async function readKubeconfigCandidate(
  candidate: KubernetesKubeconfigCandidate,
  contextName: string | undefined,
): Promise<KubernetesKubeconfigCandidateResult> {
  let contents: string;
  try {
    contents = await readFile(candidate.path, 'utf8');
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Kubeconfig read failed.');
    return { document: null, reason: readKubeconfigFileFailureReason(failure, candidate.label), resolved: null };
  }
  return parseKubeconfigCandidate(contents, candidate.path, candidate.label, contextName);
}

function parseKubeconfigCandidate(
  contents: string,
  path: string,
  label: string | undefined,
  contextName: string | undefined,
): KubernetesKubeconfigCandidateResult {
  try {
    const value: JsonValue = parse(contents) as JsonValue;
    if (!isObject(value)) {
      return unusableCandidate();
    }
    const resolved: ResolvedKubernetesKubeconfig | null = parseKubeconfig(value, path, label, contextName);
    const reason: string = resolved === null ? readDocumentFailureReason(value, contextName) : 'usable';
    return { document: value, reason, resolved };
  } catch {
    return unusableCandidate();
  }
}

async function materializeMergedKubeconfig(
  merged: KubernetesKubeconfigDocument,
  resolved: ResolvedKubernetesKubeconfig,
): Promise<ResolvedKubernetesKubeconfig> {
  const materializedDirectory: string = await mkdtemp(resolve(tmpdir(), 'compartment-kubeconfig-'));
  const path: string = join(materializedDirectory, 'kubeconfig.json');
  await writeFile(path, JSON.stringify(merged), { mode: 0o600 });
  return { ...resolved, materializedDirectory, path };
}

function requireResolvedKubeconfig(
  merged: KubernetesKubeconfigDocument,
  path: string,
  contextName: string | undefined,
  checked: readonly string[],
): ResolvedKubernetesKubeconfig {
  const resolved: ResolvedKubernetesKubeconfig | null = parseKubeconfig(merged, path, undefined, contextName);
  if (resolved === null) {
    const contextMissing: boolean = contextName !== undefined && !hasKubeconfigContext(merged, contextName);
    throw new Error(buildMissingKubeconfigMessage(checked, contextName, true, contextMissing));
  }
  return resolved;
}

function parseKubeconfig(
  value: KubernetesKubeconfigDocument,
  path: string,
  label: string | undefined,
  requestedContextName: string | undefined,
): ResolvedKubernetesKubeconfig | null {
  const clusters: JsonValue | undefined = value.clusters;
  const contexts: JsonValue | undefined = value.contexts;
  if (!Array.isArray(clusters) || !Array.isArray(contexts)) {
    return null;
  }
  const contextName: string | undefined = requestedContextName ?? readCurrentContext(value);
  const clusterName: string | undefined = readCurrentClusterName(contexts, contextName);
  const clusterServer: string | undefined = readClusterServer(clusters, clusterName);
  if (contextName === undefined || clusterServer === undefined) {
    return null;
  }
  return { clusterServer, contextName, ...(label === undefined ? {} : { label }), path };
}

function buildDefaultCandidates(input: KubernetesKubeconfigResolutionInput): KubernetesKubeconfigCandidate[] {
  const homePath: string = join(input.homeDirectory, '.kube', 'config');
  const k3sPath: string = input.k3sPath ?? defaultK3sKubeconfigPath;
  return [
    { configured: false, displayPath: '~/.kube/config', path: homePath },
    { configured: false, displayPath: k3sPath, label: 'k3s', path: k3sPath },
  ];
}

function readCurrentClusterName(contexts: JsonValue[], contextName: string | undefined): string | undefined {
  const context: JsonValue | undefined = contexts.find(
    (candidate: JsonValue): boolean => isObject(candidate) && candidate.name === contextName,
  );
  return isObject(context) && isObject(context.context) && typeof context.context.cluster === 'string'
    ? context.context.cluster
    : undefined;
}

function readClusterServer(clusters: JsonValue[], clusterName: string | undefined): string | undefined {
  const cluster: JsonValue | undefined = clusters.find(
    (candidate: JsonValue): boolean => isObject(candidate) && candidate.name === clusterName,
  );
  const server: JsonValue | undefined =
    isObject(cluster) && isObject(cluster.cluster) ? cluster.cluster.server : undefined;
  return typeof server === 'string' && server.trim() !== '' ? server.trim() : undefined;
}

function readDocumentFailureReason(document: KubernetesKubeconfigDocument, contextName: string | undefined): string {
  if (contextName !== undefined && !hasKubeconfigContext(document, contextName)) {
    return `context "${contextName}" not found`;
  }
  return contextName === undefined && readCurrentContext(document) === undefined ? 'no current context' : 'unusable';
}

function readCurrentContext(document: KubernetesKubeconfigDocument): string | undefined {
  const value: JsonValue | undefined = document['current-context'];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function hasRequestedContext(document: KubernetesKubeconfigDocument | null, contextName: string | undefined): boolean {
  return document !== null && contextName !== undefined && hasKubeconfigContext(document, contextName);
}

function hasKubeconfigContext(document: KubernetesKubeconfigDocument, contextName: string): boolean {
  const contexts: JsonValue | undefined = document.contexts;
  return (
    Array.isArray(contexts) &&
    contexts.some((context: JsonValue): boolean => isObject(context) && context.name === contextName)
  );
}

function readKubeconfigFileFailureReason(error: Error, label: string | undefined): string {
  if (readErrorCode(error) === 'ENOENT') {
    return 'not found';
  }
  if (readErrorCode(error) === 'EACCES') {
    return label === 'k3s' ? 'exists but not readable — run with sudo or export KUBECONFIG' : 'exists but not readable';
  }
  return 'unusable';
}

function readErrorCode(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function buildMissingKubeconfigMessage(
  checked: readonly string[],
  contextName?: string,
  configured: boolean = false,
  contextMissing: boolean = false,
): string {
  const prefix: string =
    contextName !== undefined && contextMissing ? `context "${contextName}" not found.` : 'No usable kubeconfig found.';
  const environmentChecked: string = configured ? '' : '$KUBECONFIG (not set), ';
  const checkedMessage: string = ` Checked: ${environmentChecked}${checked.join(', ')}.`;
  if (checked.some((value: string): boolean => value.includes('run with sudo or export KUBECONFIG'))) {
    return `${prefix}${checkedMessage}`;
  }
  return configured
    ? `${prefix}${checkedMessage} Fix the configured path or context; no fallback kubeconfig was used.`
    : `${prefix}${checkedMessage} If you have a cluster, point KUBECONFIG at it. If not, install one first (e.g. k3s: curl -sfL https://get.k3s.io | sh -s - --disable traefik).`;
}

function formatCheckedCandidate(candidate: KubernetesKubeconfigCandidate, reason: string): string {
  return candidate.configured ? `$KUBECONFIG (${candidate.path}: ${reason})` : `${candidate.displayPath} (${reason})`;
}

function assertConfiguredPaths(paths: readonly string[]): void {
  if (paths.length === 0) {
    throw new Error('No usable kubeconfig found. $KUBECONFIG is set but contains no paths.');
  }
}

function unusableCandidate(): KubernetesKubeconfigCandidateResult {
  return { document: null, reason: 'unusable', resolved: null };
}

function isObject(value: JsonValue | undefined): value is KubernetesKubeconfigDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
