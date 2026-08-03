import type { CliIo } from '../../app.types';
import { quoteShellArgumentWhenNeeded } from '@compartment/utils';
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

interface ExistingSecretTlsValues {
  registry: InstallWizardRegistryValues;
  tls: InstallWizardTlsValues;
  tlsReview: string;
}

const adminPasswordEnvironmentName: string = ['COMPARTMENT', 'ADMIN', 'PASSWORD'].join('_');
const ownerPasswordPlaceholder: string = ['OWNER', 'PASSWORD'].join('_');

export interface OperatorDomainTlsPromptInput {
  baseDomain: string;
  ingressClass: string;
  kubeContext: string;
  namespace: string;
  releaseName: string;
  storageClass: string;
  inspectIssuer: InspectKubernetesInstallIssuer;
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
    return await resolveIssuerTls(io, input);
  }
  if (mode === '2') {
    const secretTls: ExistingSecretTlsValues = await resolveExistingSecretTls(io, input);
    return { input: { baseDomain: input.baseDomain }, ...secretTls };
  }
  if (mode === '3') {
    throw new Error(buildOperatorValuesInstructions(input));
  }
  throw new Error('TLS selection must be 1, 2, or 3.');
}

async function resolveLocalhostRegistryTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<KubernetesInstallWizardDomain> {
  const registry: InstallWizardRegistryValues = await resolveRegistryIpTls(io, input);
  return {
    input: { baseDomain: input.baseDomain },
    registry,
    tlsReview: `public TLS not required; registry ${registry.issuerRef.kind}/${registry.issuerRef.name}`,
  };
}

function renderTlsChoices(io: CliIo, namespace: string): void {
  io.stderr(
    'TLS for the operator-owned domain:\n' +
      '  1. cert-manager Issuer or ClusterIssuer [default]\n' +
      '  2. Existing kubernetes.io/tls Secret\n' +
      '  3. Stop and configure an operator values file\n' +
      `Namespaced Issuers and Secrets must exist in namespace "${namespace}".\n`,
  );
}

async function resolveIssuerTls(
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
): Promise<KubernetesInstallWizardDomain> {
  const issuerRef: InstallWizardIssuerReference = await promptIssuerReference(io, 'Platform TLS');
  const assessment: KubernetesOperatorIssuerAssessment = await inspectIssuerTrust(io, input, issuerRef);
  const registry: InstallWizardRegistryValues =
    assessment.trust === 'ca' ? { issuerRef } : await resolveRegistryIpTls(io, input);
  return {
    input: { baseDomain: input.baseDomain },
    registry,
    tls: { issuerRef },
    tlsReview: `${issuerRef.kind}/${issuerRef.name}; registry ${registry.issuerRef.kind}/${registry.issuerRef.name}`,
  };
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
  const issuerRef: InstallWizardIssuerReference = await promptIssuerReference(io, 'Private registry TLS');
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
  const issuerRef: InstallWizardIssuerReference = await promptIssuerReference(io, 'Private registry TLS');
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

async function promptIssuerReference(io: CliIo, label: string): Promise<InstallWizardIssuerReference> {
  const kindValue: string = await promptVisibleText(io, `${label} issuer kind (Issuer/ClusterIssuer)`, 'ClusterIssuer');
  if (kindValue !== 'Issuer' && kindValue !== 'ClusterIssuer') {
    throw new Error(`${label} issuer kind must be Issuer or ClusterIssuer.`);
  }
  return {
    kind: kindValue,
    name: await promptValidatedVisibleText(io, `${label} issuer name`, (value: string): string | undefined =>
      validateKubernetesResourceName(value, `${label} issuer name`),
    ),
  };
}

function buildOperatorValuesInstructions(input: OperatorDomainTlsPromptInput): string {
  return (
    'Operator-owned domain installation stopped before owner setup. Create compartment-values.yaml:\n' +
    `ingress:\n  className: ${input.ingressClass}\n` +
    'tls:\n  issuerRef:\n    kind: ClusterIssuer\n    name: <issuer-name>\n' +
    'registry:\n  issuerRef:\n    kind: ClusterIssuer\n    name: <node-trusted-ca-issuer>\n' +
    `storage:\n  storageClass: ${input.storageClass}\n` +
    'Then replace the uppercase placeholders and run:\n' +
    `${adminPasswordEnvironmentName}='${ownerPasswordPlaceholder}' compartment install ` +
    `--kube-context ${quoteShellArgumentWhenNeeded(input.kubeContext)} ` +
    `--namespace ${quoteShellArgumentWhenNeeded(input.namespace)} ` +
    `--release-name ${quoteShellArgumentWhenNeeded(input.releaseName)} ` +
    `--base-domain ${quoteShellArgumentWhenNeeded(input.baseDomain)} ` +
    "--email 'OWNER_EMAIL' --organization 'ORGANIZATION_NAME' " +
    '--values compartment-values.yaml'
  );
}
