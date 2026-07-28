import type { DomainHostPlan } from '@compartment/contracts';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import { buildDomainTlsSecretName } from './kubernetes-system-domain-release.support';
import type {
  KubernetesSystemDomainIngress,
  KubernetesSystemDomainIngressList,
  KubernetesSystemDomainIngressRule,
  KubernetesSystemDomainIngressTls,
} from './kubernetes-system-domain-readiness.types';

const domainReadinessTimeoutMs: number = 10 * 60_000;

export async function waitForKubernetesSystemDomainReadiness(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  operationId?: string,
): Promise<void> {
  const ingress: KubernetesSystemDomainIngress = await readPublishedIngress(target, hostPlan);
  if (hostPlan.tlsMode === 'custom-cert') {
    await assertCustomCertificateSecretReady(target, hostPlan, ingress, operationId);
    return;
  }
  await assertCertificateReady(target);
}

async function readPublishedIngress(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
): Promise<KubernetesSystemDomainIngress> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(target, [
      'get',
      'ingress',
      '--selector',
      `app.kubernetes.io/instance=${target.releaseName},app.kubernetes.io/component=ingress`,
      '--output',
      'json',
    ]),
    domainReadinessTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw readinessError('Ingress endpoint was not published', result);
  }
  return requirePublishedIngress(result, hostPlan);
}

function requirePublishedIngress(result: CommandResult, hostPlan: DomainHostPlan): KubernetesSystemDomainIngress {
  const list: KubernetesSystemDomainIngressList = JSON.parse(result.stdout) as KubernetesSystemDomainIngressList;
  const ingress: KubernetesSystemDomainIngress | undefined = list.items[0];
  const published: boolean = (ingress?.status?.loadBalancer?.ingress?.length ?? 0) > 0;
  const requiredHosts: string[] = [`console.${hostPlan.baseDomain}`, `*.${hostPlan.baseDomain}`];
  const ruleHosts: string[] =
    ingress?.spec?.rules?.flatMap((rule: KubernetesSystemDomainIngressRule): string[] =>
      rule.host === undefined ? [] : [rule.host],
    ) ?? [];
  if (ingress === undefined || !published || requiredHosts.some((host: string): boolean => !ruleHosts.includes(host))) {
    throw readinessError('Ingress hosts or endpoint did not converge', result);
  }
  return ingress;
}

async function assertCustomCertificateSecretReady(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  ingress: KubernetesSystemDomainIngress,
  operationId: string | undefined,
): Promise<void> {
  const expectedSecret: string | undefined =
    operationId === undefined ? undefined : buildDomainTlsSecretName(target.releaseName, operationId);
  const requiredHosts: string[] = [`console.${hostPlan.baseDomain}`, `*.${hostPlan.baseDomain}`];
  const tlsEntries: KubernetesSystemDomainIngressTls[] = ingress.spec?.tls ?? [];
  const secretName: string = requireSharedTlsSecret(requiredHosts, tlsEntries, expectedSecret);
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(target, ['get', 'secret', secretName, '--output', 'name']),
    domainReadinessTimeoutMs,
  );
  if (result.exitCode !== 0 || result.stdout.trim() === '') {
    throw readinessError('Ingress TLS Secret does not exist', result);
  }
}

function requireSharedTlsSecret(
  requiredHosts: string[],
  tlsEntries: KubernetesSystemDomainIngressTls[],
  expectedSecret: string | undefined,
): string {
  const matchingSecrets: string[] = requiredHosts.map((host: string): string => {
    const entry: KubernetesSystemDomainIngressTls | undefined = tlsEntries.find(
      (candidate: KubernetesSystemDomainIngressTls): boolean => candidate.hosts?.includes(host) === true,
    );
    return entry?.secretName ?? '';
  });
  const secretName: string = matchingSecrets[0] ?? '';
  const mismatched: boolean = matchingSecrets.some((candidate: string): boolean => candidate !== secretName);
  if (secretName === '' || mismatched || (expectedSecret !== undefined && secretName !== expectedSecret)) {
    throw readinessError('Ingress TLS Secret reference did not converge', { exitCode: 1, stderr: '', stdout: '' });
  }
  return secretName;
}

async function assertCertificateReady(target: KubernetesOperatorTarget): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(target, [
      'wait',
      'certificates.cert-manager.io',
      '--selector',
      `app.kubernetes.io/instance=${target.releaseName},app.kubernetes.io/component=platform-tls`,
      '--for=condition=Ready',
      '--timeout=10m',
    ]),
    domainReadinessTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw readinessError('Certificate did not reach Ready=True', result);
  }
}

function readinessError(reason: string, result: CommandResult): Error {
  const output: string = readCommandOutput(result);
  return new Error(
    `System-domain activation is waiting: ${reason}. The retained domain generation was not committed.${output === '' ? '' : `\n${output}`}`,
  );
}
