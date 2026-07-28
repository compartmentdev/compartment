import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { immutableKubeName } from '@compartment/utils';
import { buildHelmUpgradeCommand } from './kubernetes-command.support';
import { buildKubernetesHelmValuesArgs } from './kubernetes-install-helm.service';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

const helmDomainTimeout: string = '10m';

export function buildDomainHelmCommand(
  target: KubernetesOperatorTarget,
  chartPath: string,
  operatorValuesPath: string,
  domainValuesPath: string,
  imageTrustValuesPath: string,
): string[] {
  return buildHelmUpgradeCommand(target, target.releaseName, chartPath, [
    '--reuse-values',
    ...buildKubernetesHelmValuesArgs([operatorValuesPath, domainValuesPath, imageTrustValuesPath]),
    '--rollback-on-failure',
    '--wait',
    '--timeout',
    helmDomainTimeout,
  ]);
}

export function buildDomainTlsSecretName(releaseName: string, operationId: string): string {
  return immutableKubeName('domain-tls', `${releaseName}:${operationId}`);
}

export async function readRequiredPemFile(path: string, label: string): Promise<string> {
  const contents: string = await readFile(resolve(path), 'utf8');
  if (contents.trim() === '') {
    throw new Error(`The ${label} file is empty.`);
  }
  return contents;
}

export function requireOperatorValuesPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('--values is required for a system-domain command that changes Kubernetes resources.');
  }
  return value;
}
