import { isIPv4 } from 'node:net';
import { delimiter, resolve } from 'node:path';
import { type JsonValue } from '@compartment/utils';
import { isMap, isSeq, parseDocument, type Document, type ParsedNode } from 'yaml';
import type { KubernetesRegistryMirror } from './kubernetes-registry-mirror.service.types';

const k3sKubeconfigPath: string = '/etc/rancher/k3s/k3s.yaml';
const registryPort: number = 5000;
const registryHostPattern: RegExp = /^(?:[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.){2,}svc:5000$/u;

export function createKubernetesRegistryMirror(
  serviceName: string,
  namespace: string,
  clusterIp: string,
): KubernetesRegistryMirror {
  if (serviceName.trim() === '' || namespace.trim() === '') {
    throw new Error('Registry-auth Service name and namespace are required.');
  }
  return createKubernetesRegistryMirrorFromHost(
    `${serviceName}.${namespace}.svc:${registryPort.toString()}`,
    clusterIp,
  );
}

export function createKubernetesRegistryMirrorFromHost(
  registryHost: string,
  clusterIp: string,
): KubernetesRegistryMirror {
  if (!registryHostPattern.test(registryHost)) {
    throw new Error('Registry mirror host must be a canonical Kubernetes Service DNS name on port 5000.');
  }
  if (!isIPv4(clusterIp)) {
    throw new Error(`Registry-auth Service must have an IPv4 clusterIP, received: ${clusterIp}`);
  }
  return { clusterIp, host: registryHost };
}

export function renderKubernetesRegistryMirrorConfig(mirror: KubernetesRegistryMirror): string {
  return mergeKubernetesRegistryMirrorConfig('', mirror);
}

export function mergeKubernetesRegistryMirrorConfig(existingConfig: string, mirror: KubernetesRegistryMirror): string {
  const document: Document.Parsed<ParsedNode> = parseRegistryConfig(existingConfig);
  const endpointPath: string[] = ['mirrors', mirror.host, 'endpoint'];
  const currentEndpoint: ParsedNode | null | undefined = document.getIn(endpointPath, true) as
    | ParsedNode
    | null
    | undefined;
  if (isCurrentEndpoint(currentEndpoint, mirror)) {
    return existingConfig;
  }
  const mirrorsNode: ParsedNode | null | undefined = document.get('mirrors') as ParsedNode | null | undefined;
  if (mirrorsNode !== undefined && mirrorsNode !== null && !isMap(mirrorsNode)) {
    throw new Error('Existing k3s registry config has a non-map mirrors value.');
  }
  document.setIn(endpointPath, [readKubernetesRegistryMirrorEndpoint(mirror)]);
  return document.toString();
}

export function isLocalK3sKubeconfigChain(environment: NodeJS.ProcessEnv, kubeContext: string | undefined): boolean {
  const kubeconfig: string | undefined = environment.KUBECONFIG;
  if (kubeconfig === undefined || kubeContext !== undefined) {
    return false;
  }
  const paths: string[] = kubeconfig.split(delimiter).filter((path: string): boolean => path.trim() !== '');
  return paths.length === 1 && resolve(paths[0]!) === k3sKubeconfigPath;
}

function parseRegistryConfig(config: string): Document.Parsed<ParsedNode> {
  const document: Document.Parsed<ParsedNode> = parseDocument(config);
  if (document.errors.length > 0) {
    throw new Error(`Existing k3s registry config is invalid YAML: ${document.errors[0]!.message}`);
  }
  return document;
}

function isCurrentEndpoint(endpoint: ParsedNode | null | undefined, mirror: KubernetesRegistryMirror): boolean {
  if (!isSeq(endpoint)) {
    return false;
  }
  const values: JsonValue = endpoint.toJSON() as JsonValue;
  return Array.isArray(values) && values.length === 1 && values[0] === readKubernetesRegistryMirrorEndpoint(mirror);
}

function readKubernetesRegistryMirrorEndpoint(mirror: KubernetesRegistryMirror): string {
  return `http://${mirror.clusterIp}:${registryPort.toString()}`;
}
