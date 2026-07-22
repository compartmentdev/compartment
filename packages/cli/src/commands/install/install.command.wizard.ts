import { hasText } from '@compartment/utils';
import type { CliIo } from '../../app.types';
import { promptVisibleText } from '../../prompts/prompt';
import type { InstallWizardAnswers, InstallWizardResolution, InstallWizardValues } from './install.command.types';
import { normalizeInstallBaseDomain } from './install.command.validation';

export async function resolveInstallWizard(io: CliIo, detectedStorageClass: string): Promise<InstallWizardResolution> {
  const domainMode: 'custom' | 'managed' = await promptDomainMode(io);
  const domainAnswers: Partial<InstallWizardAnswers> = domainMode === 'managed' ? {} : await promptCustomDomain(io);
  const storageClass: string = await promptVisibleText(
    io,
    'Storage class',
    detectedStorageClass === '' ? undefined : detectedStorageClass,
  );
  const answers: InstallWizardAnswers = { domainMode, storageClass, ...domainAnswers };
  return { answers, values: buildInstallWizardValues(answers) };
}

function buildInstallWizardValues(answers: InstallWizardAnswers): InstallWizardValues {
  return {
    ...(answers.customTlsSecret === undefined ? {} : { customTls: { existingSecret: answers.customTlsSecret } }),
    ...(answers.tlsMode === undefined ? {} : { platform: { tlsMode: answers.tlsMode } }),
    storage: { storageClass: answers.storageClass },
  };
}

async function promptDomainMode(io: CliIo): Promise<'custom' | 'managed'> {
  io.stderr('Domain:\n  1. Managed (*.app.compartment.run, automatic) [default]\n  2. Custom domain\n');
  for (;;) {
    const answer: string = await promptVisibleText(io, 'Domain', '1');
    if (answer === '1') {
      return 'managed';
    }
    if (answer === '2') {
      return 'custom';
    }
    io.stderr('Enter `1` or `2`.\n');
  }
}

async function promptCustomDomain(io: CliIo): Promise<Partial<InstallWizardAnswers>> {
  const baseDomain: string = await promptBaseDomain(io);
  io.stderr('TLS mode:\n  1. custom-http (external TLS termination) [default]\n  2. custom-cert\n');
  for (;;) {
    const answer: string = await promptVisibleText(io, 'TLS mode', '1');
    if (answer === '1') {
      return { baseDomain, tlsMode: 'custom-http' };
    }
    if (answer === '2') {
      return {
        baseDomain,
        customTlsSecret: await promptExistingTlsSecret(io),
        tlsMode: 'custom-cert',
      };
    }
    io.stderr('Enter `1` or `2`.\n');
  }
}

async function promptExistingTlsSecret(io: CliIo): Promise<string> {
  for (;;) {
    const value: string = await promptVisibleText(io, 'Existing Kubernetes TLS Secret');
    if (hasText(value) && value.length <= 253 && kubernetesSecretNamePattern.test(value)) {
      return value;
    }
    io.stderr('Enter the name of an existing Kubernetes TLS Secret in the install namespace.\n');
  }
}

const kubernetesSecretNamePattern: RegExp = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/u;

async function promptBaseDomain(io: CliIo): Promise<string> {
  for (;;) {
    const value: string = await promptVisibleText(io, 'Base domain');
    try {
      return normalizeInstallBaseDomain(value);
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : 'Invalid base domain.'}\n`);
    }
  }
}
