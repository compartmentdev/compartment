import type { DomainIssuerReference } from '@compartment/contracts';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand } from './kubernetes-command.support';
import {
  KubernetesExistingClusterPreflightError,
  readCommandFailure,
} from './kubernetes-existing-cluster-preflight.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';
import type {
  KubernetesCertManagerIssuer,
  KubernetesOperatorIssuerAssessment,
} from './kubernetes-operator-issuer-trust.service.types';

const publiclyTrustedAcmeHosts: ReadonlySet<string> = new Set([
  'acme-v02.api.letsencrypt.org',
  'acme.zerossl.com',
  'dv.acme-v02.api.pki.goog',
]);

export async function inspectOperatorIssuer(
  input: Pick<KubernetesInstallDeploymentInput, 'kubeconfigPath' | 'kubeContext' | 'namespace'>,
  issuer: DomainIssuerReference,
): Promise<KubernetesOperatorIssuerAssessment> {
  const result: CommandResult = await readOperatorIssuer(input, issuer);
  if (result.exitCode === 0) {
    return assessOperatorIssuer(issuer, result.stdout);
  }
  if (result.stderr.toLowerCase().includes('forbidden')) {
    return unreadableIssuerAssessment(issuer);
  }
  throw unavailableIssuerError(input.namespace, issuer, result);
}

export function assertRegistryIpIssuerAssessment(assessment: KubernetesOperatorIssuerAssessment): void {
  if (assessment.trust === 'ca') {
    return;
  }
  throw new Error(
    `Private registry IP certificates require a cert-manager CA issuer whose CA is already trusted by every Kubernetes node runtime. ${assessment.detail}`,
  );
}

export function assertPublicDns01IssuerAssessment(
  issuer: DomainIssuerReference,
  assessment: KubernetesOperatorIssuerAssessment,
): void {
  if (assessment.ready === undefined) {
    throw new KubernetesExistingClusterPreflightError(
      'cert-manager',
      `${assessment.detail} The selected issuer must be inspectable so Compartment can verify Ready=True and an ACME DNS-01 solver before issuing a wildcard certificate.`,
    );
  }
  if (assessment.ready !== true) {
    throw new KubernetesExistingClusterPreflightError(
      'cert-manager',
      `Selected ${issuer.kind} ${issuer.name} is not Ready=True. Make the issuer ready before installing.`,
    );
  }
  if (assessment.dns01 !== true) {
    throw new KubernetesExistingClusterPreflightError(
      'cert-manager',
      `Selected ${issuer.kind} ${issuer.name} has no ACME DNS-01 solver. Wildcard certificates cannot use HTTP-01; configure a DNS-01 solver for the operator-owned domain.`,
    );
  }
}

async function readOperatorIssuer(
  input: Pick<KubernetesInstallDeploymentInput, 'kubeconfigPath' | 'kubeContext' | 'namespace'>,
  issuer: DomainIssuerReference,
): Promise<CommandResult> {
  const resource: string =
    issuer.kind === 'ClusterIssuer' ? 'clusterissuers.cert-manager.io' : 'issuers.cert-manager.io';
  const command: string[] = ['get', resource, issuer.name];
  if (issuer.kind === 'Issuer') {
    command.push('--namespace', input.namespace);
  }
  command.push('-o=json');
  return await runCommand(buildKubectlCommand(input, ['--request-timeout=5s', ...command]));
}

function assessOperatorIssuer(issuer: DomainIssuerReference, output: string): KubernetesOperatorIssuerAssessment {
  const resource: KubernetesCertManagerIssuer | null = parseIssuer(output);
  if (resource === null) {
    return unknownIssuerAssessment(issuer, 'Kubernetes returned invalid JSON');
  }
  if (resource.spec?.selfSigned !== undefined) {
    throw selfSignedIssuerError(issuer);
  }
  const capabilities: Pick<KubernetesOperatorIssuerAssessment, 'dns01' | 'ready'> = assessIssuerCapabilities(resource);
  if (isRecognizedPublicAcme(resource)) {
    return { ...capabilities, detail: `${issuer.kind} ${issuer.name} uses ACME.`, trust: 'acme' };
  }
  if (resource.spec?.acme !== undefined) {
    return {
      ...unknownIssuerAssessment(
        issuer,
        'ACME does not guarantee public trust and its server is not a recognized public CA endpoint',
      ),
      ...capabilities,
    };
  }
  const assessment: KubernetesOperatorIssuerAssessment =
    resource.spec?.ca === undefined
      ? unknownIssuerAssessment(issuer, 'its cert-manager spec does not identify a known trust model')
      : caIssuerAssessment(issuer);
  return { ...assessment, ...capabilities };
}

function assessIssuerCapabilities(
  issuer: KubernetesCertManagerIssuer,
): Pick<KubernetesOperatorIssuerAssessment, 'dns01' | 'ready'> {
  return {
    dns01: issuer.spec?.acme?.solvers?.some((solver): boolean => solver.dns01 !== undefined) === true,
    ready:
      issuer.status?.conditions?.some(
        (condition): boolean => condition.type === 'Ready' && condition.status === 'True',
      ) === true,
  };
}

function isRecognizedPublicAcme(issuer: KubernetesCertManagerIssuer): boolean {
  const server: string | undefined = issuer.spec?.acme?.server;
  if (server === undefined) {
    return false;
  }
  try {
    return publiclyTrustedAcmeHosts.has(new URL(server).hostname);
  } catch {
    return false;
  }
}

function parseIssuer(output: string): KubernetesCertManagerIssuer | null {
  try {
    return JSON.parse(output) as KubernetesCertManagerIssuer;
  } catch {
    return null;
  }
}

function selfSignedIssuerError(issuer: DomainIssuerReference): KubernetesExistingClusterPreflightError {
  return new KubernetesExistingClusterPreflightError(
    'cert-manager',
    `${issuer.kind} ${issuer.name} uses spec.selfSigned and cannot satisfy an operator-owned installation. Use a CA issuer whose CA is distributed to every node and the operator machine for the private registry. Public platform TLS may use a publicly trusted ACME issuer or tls.existingSecret.`,
  );
}

function caIssuerAssessment(issuer: DomainIssuerReference): KubernetesOperatorIssuerAssessment {
  return {
    detail: `${issuer.kind} ${issuer.name} uses spec.ca. Continue only if that CA is installed in the trust stores of every Kubernetes node and the operator machine; otherwise registry node pulls and the CLI public HTTPS probe will fail.`,
    trust: 'ca',
  };
}

function unknownIssuerAssessment(issuer: DomainIssuerReference, reason: string): KubernetesOperatorIssuerAssessment {
  return {
    detail: `Cannot determine how ${issuer.kind} ${issuer.name} issues certificates because ${reason}. Verify independently that its certificates are trusted by every Kubernetes node and by the operator machine.`,
    trust: 'unknown',
  };
}

function unreadableIssuerAssessment(issuer: DomainIssuerReference): KubernetesOperatorIssuerAssessment {
  return {
    detail: `Cannot inspect ${issuer.kind} ${issuer.name} because Kubernetes denied read access. Verify independently that its certificates are trusted by every cluster node and by the operator machine.`,
    trust: 'unreadable',
  };
}

function unavailableIssuerError(
  namespace: string,
  issuer: DomainIssuerReference,
  result: CommandResult,
): KubernetesExistingClusterPreflightError {
  return new KubernetesExistingClusterPreflightError(
    'cert-manager',
    `Selected ${issuer.kind} ${issuer.name} is not available${issuer.kind === 'Issuer' ? ` in namespace ${namespace}` : ''}: ${readCommandFailure(result)}. Configure registry.issuerRef or tls.issuerRef with an existing cert-manager issuer before retrying.`,
  );
}
