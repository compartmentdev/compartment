import type { CliIo } from '../../app.types';
import { promptValidatedVisibleText, promptVisibleText } from '../../prompts/prompt';
import { validateKubernetesResourceName } from '../../services/kubernetes-resource-name';
import { isReservedKubernetesInstallLocalhostDomain } from '../../kubernetes-install-domain';
import type {
  InstallWizardIssuerReference,
  InstallWizardRegistryValues,
  InstallWizardTlsValues,
} from './install.command.types';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardDomain,
} from './install.command.kubernetes-wizard.types';
import type { KubernetesOperatorIssuerAssessment } from '../../services/kubernetes-operator-issuer-trust.service.types';
import { readPromptLine } from '../../prompts/prompt-reader';
import type { KubernetesInstallIssuerChoice } from '../../services/kubernetes-install-inventory.service.types';

interface ExistingSecretTlsValues {
  registry: InstallWizardRegistryValues;
  tls: InstallWizardTlsValues;
  tlsReview: string;
}

export interface OperatorDomainTlsPromptInput {
  baseDomain: string;
  kubeContext: string;
  namespace: string;
  inspectIssuer: InspectKubernetesInstallIssuer;
  issuers: readonly KubernetesInstallIssuerChoice[];
}

export async function resolveOperatorDomainTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<KubernetesInstallWizardDomain> {
  if (isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return await resolveLocalhostRegistryTls(io, input);
  }
  renderTlsChoices(io, input.namespace);
  const mode: string = await promptVisibleText(io, 'TLS', '1');
  if (mode === '1') {
    return await resolveExternalTls(io, input);
  }
  if (mode === '2') {
    const secretTls: ExistingSecretTlsValues = await resolveExistingSecretTls(io, input);
    return { input: { baseDomain: input.baseDomain, publicProtocol: 'https' }, ...secretTls };
  }
  throw new Error('TLS selection must be 1 or 2.');
}

async function resolveExternalTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<KubernetesInstallWizardDomain> {
  const registry: InstallWizardRegistryValues = await resolveRegistryIpTls(io, input);
  return {
    input: { baseDomain: input.baseDomain, publicProtocol: 'http' },
    registry,
    tlsReview: `external TLS termination; platform HTTP; registry ${registry.issuerRef.kind}/${registry.issuerRef.name}`,
  };
}

async function resolveLocalhostRegistryTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<KubernetesInstallWizardDomain> {
  const registry: InstallWizardRegistryValues = await resolveRegistryIpTls(io, input);
  return {
    input: { baseDomain: input.baseDomain, publicProtocol: 'http' },
    registry,
    tlsReview: `public TLS not required; registry ${registry.issuerRef.kind}/${registry.issuerRef.name}`,
  };
}

function renderTlsChoices(io: CliIo, namespace: string): void {
  io.stderr(
    'TLS for the operator-owned domain:\n' +
      '  1. External TLS termination; platform serves HTTP [default]\n' +
      '  2. Existing kubernetes.io/tls Secret\n' +
      `Namespaced Issuers and Secrets must exist in namespace "${namespace}".\n`,
  );
}

async function resolveExistingSecretTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<ExistingSecretTlsValues> {
  const existingSecret: string = await promptValidatedVisibleText(
    io,
    'Existing TLS Secret',
    (value: string): string | undefined => validateKubernetesResourceName(value, 'Existing TLS Secret'),
  );
  const issuerRef: InstallWizardIssuerReference = await promptIssuerReference(io, input, 'Private registry TLS');
  await assertRegistryIpIssuer(io, input, issuerRef);
  return {
    registry: { issuerRef },
    tls: { existingSecret },
    tlsReview: `Secret/${existingSecret}; registry ${issuerRef.kind}/${issuerRef.name}`,
  };
}

export async function resolveRegistryIpTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<InstallWizardRegistryValues> {
  const issuerRef: InstallWizardIssuerReference = await promptIssuerReference(io, input, 'Private registry TLS');
  await assertRegistryIpIssuer(io, input, issuerRef);
  return { issuerRef };
}

async function assertRegistryIpIssuer(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
  issuerRef: InstallWizardIssuerReference,
): Promise<void> {
  const assessment: KubernetesOperatorIssuerAssessment = await inspectIssuerTrust(io, input, issuerRef);
  if (assessment.trust !== 'ca') {
    throw new Error('Private registry IP certificates require a cert-manager CA issuer.');
  }
}

async function inspectIssuerTrust(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
  issuerRef: InstallWizardIssuerReference,
): Promise<KubernetesOperatorIssuerAssessment> {
  const assessment: KubernetesOperatorIssuerAssessment = await input.inspectIssuer(
    input.kubeContext,
    input.namespace,
    issuerRef,
  );
  if (assessment.trust === 'acme') {
    return assessment;
  }
  io.stderr(`TLS trust warning: ${assessment.detail}\n`);
  if (assessment.trust === 'ca') {
    await confirmIssuerTrust(io, 'Confirm that the private CA is distributed to every node and this machine');
  }
  if (assessment.trust === 'unknown') {
    await confirmIssuerTrust(io, 'Confirm that the issued certificate chain is trusted by every node and this machine');
  }
  return assessment;
}

async function confirmIssuerTrust(io: CliIo, message: string): Promise<void> {
  const answer: string = (await readPromptLine(io, `${message} [y/N]: `)).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error('Installation cancelled because private CA trust was not confirmed.');
  }
}

async function promptIssuerReference(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
  label: string,
): Promise<InstallWizardIssuerReference> {
  if (input.issuers.length === 0) {
    throw missingIssuerPrerequisiteError(input.namespace);
  }
  io.stderr(`${label} issuer:\n`);
  input.issuers.forEach((issuer: KubernetesInstallIssuerChoice, index: number): void =>
    io.stderr(`  ${String(index + 1)}. ${issuer.kind}/${issuer.name}${index === 0 ? ' [default]' : ''}\n`),
  );
  const answer: string = await promptVisibleText(io, `${label} issuer`, '1');
  const index: number = Number(answer) - 1;
  const selected: KubernetesInstallIssuerChoice | undefined = input.issuers[index];
  if (!Number.isInteger(index) || selected === undefined) {
    throw new Error(`${label} issuer selection must be one of the discovered choices.`);
  }
  return selected;
}

function missingIssuerPrerequisiteError(namespace: string): Error {
  return new Error(`Missing prerequisite: no cert-manager Issuer exists in namespace "${namespace}" and no ClusterIssuer exists.
Run:
  kubectl --namespace ${namespace} apply -f <your-ca-issuer-manifest.yaml>
  kubectl --namespace ${namespace} get issuer
  kubectl get clusterissuer
Distribute the issuer CA to every node and this machine, then rerun compartment install.`);
}
