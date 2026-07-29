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

export function requireOperatorValuesPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('--values is required for a system-domain command that changes Kubernetes resources.');
  }
  return value;
}
