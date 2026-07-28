import type { SystemDomainMutationResponse, SystemDomainStatusResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import {
  activateKubernetesSystemDomain,
  attachKubernetesSystemDomainCertificate,
  getKubernetesSystemDomainStatus,
  resetManagedKubernetesSystemDomain,
  setKubernetesSystemDomain,
  verifyKubernetesSystemDomain,
} from '../../services/kubernetes-system-domain.service';
import type {
  KubernetesDomainVersionedInput,
  KubernetesOperatorTarget,
} from '../../services/kubernetes-operator.service.types';
import { readKubernetesTlsIssuerReference } from '../../services/kubernetes-install-tls.service';
import { withResolvedKubernetesOperatorTarget } from '../../services/kubernetes-operator-target.service';
import type { CliCommandDependencies } from '../command.types';
import {
  addKubernetesOperatorReleaseOptions,
  addKubernetesOperatorTargetOptions,
  readSystemDomainBaseDomain,
  readSystemDomainTlsMode,
  resolveKubernetesOperatorTarget,
  resolveSystemDomainVersionedCommand,
  systemDomainExpectedVersionDescription,
} from './system.command.options';
import { createSystemDomainMutationMessage, createSystemDomainStatusMessage } from './system.command.output';
import type {
  KubernetesOperatorCommandOptions,
  ResolvedSystemDomainVersionedCommand,
  SystemDomainAttachCertificateCommandOptions,
  SystemDomainSetCommandOptions,
  SystemDomainVersionedCommandOptions,
} from './system.command.types';

type VersionedDomainMutation = (input: KubernetesDomainVersionedInput) => Promise<SystemDomainMutationResponse>;
type AddOperatorOptions = (command: Command) => Command;

export function registerDomainSystemCommands(program: Command, dependencies: CliCommandDependencies): void {
  const domain: Command = program.command('domain').description('System-domain lifecycle for a Kubernetes install');
  registerDomainStatusCommand(domain, dependencies);
  registerDomainSetCommand(domain, dependencies);
  registerDomainAttachCertificateCommand(domain, dependencies);
  registerDomainLifecycleMutationCommands(domain, dependencies);
}

function registerDomainLifecycleMutationCommands(domain: Command, dependencies: CliCommandDependencies): void {
  registerDomainVerifyCommand(domain, dependencies);
  registerDomainMutationCommand(
    domain,
    dependencies,
    'activate',
    'Re-verify, roll out, and activate the pending domain',
    activateKubernetesSystemDomain,
    addKubernetesOperatorReleaseOptions,
  );
  registerDomainMutationCommand(
    domain,
    dependencies,
    'reset-managed',
    'Restore the managed domain retained by the installation',
    resetManagedKubernetesSystemDomain,
    addKubernetesOperatorReleaseOptions,
  );
}

function registerDomainVerifyCommand(domain: Command, dependencies: CliCommandDependencies): void {
  registerDomainMutationCommand(
    domain,
    dependencies,
    'verify',
    'Verify the pending domain',
    verifyKubernetesSystemDomain,
    addKubernetesOperatorTargetOptions,
  );
}

function registerDomainStatusCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program.command('status').description('Refresh and show system-domain status'),
  ).action(async (options: KubernetesOperatorCommandOptions): Promise<void> => {
    const result: SystemDomainStatusResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      getKubernetesSystemDomainStatus,
    );
    renderOutput(dependencies.io, options.output, result, createSystemDomainStatusMessage(result));
  });
}

function registerDomainSetCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorReleaseOptions(
    program
      .command('set')
      .description('Stage a custom system domain and print required DNS records')
      .requiredOption('--base-domain <domain>', 'Public base domain')
      .option('--tls <mode>', 'external or custom-cert', 'external'),
  ).action(async (options: SystemDomainSetCommandOptions): Promise<void> => {
    const baseDomain: string = readSystemDomainBaseDomain(options.baseDomain);
    const tlsMode: 'custom-cert' | 'external' = readSystemDomainTlsMode(options.tls);
    const result: SystemDomainMutationResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      async (target: KubernetesOperatorTarget): Promise<SystemDomainMutationResponse> =>
        await setKubernetesSystemDomain({
          ...target,
          baseDomain,
          ...(tlsMode === 'external'
            ? { issuerRef: await readKubernetesTlsIssuerReference(requireValuesPath(target.valuesPath)) }
            : {}),
          tlsMode,
        }),
    );
    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

function requireValuesPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('--values is required when staging an issuer-managed system domain.');
  }
  return value;
}

function registerDomainAttachCertificateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorReleaseOptions(
    program
      .command('attach-cert')
      .description('Stage a TLS Secret and validate it against the pending domain')
      .requiredOption('--cert-file <path>', 'Full-chain PEM certificate file')
      .requiredOption('--key-file <path>', 'Private-key PEM file')
      .option('--expected-version <version>', systemDomainExpectedVersionDescription),
  ).action(async (options: SystemDomainAttachCertificateCommandOptions): Promise<void> => {
    const resolved: ResolvedSystemDomainVersionedCommand = resolveSystemDomainVersionedCommand(options);
    const result: SystemDomainMutationResponse = await withResolvedKubernetesOperatorTarget(
      resolveKubernetesOperatorTarget(options),
      async (target: KubernetesOperatorTarget): Promise<SystemDomainMutationResponse> =>
        await attachKubernetesSystemDomainCertificate({
          ...target,
          ...(resolved.expectedSetupVersion === undefined
            ? {}
            : { expectedSetupVersion: resolved.expectedSetupVersion }),
          certificateFile: options.certFile,
          privateKeyFile: options.keyFile,
        }),
    );
    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

function registerDomainMutationCommand(
  program: Command,
  dependencies: CliCommandDependencies,
  name: string,
  description: string,
  mutate: VersionedDomainMutation,
  addOptions: AddOperatorOptions,
): void {
  addOptions(
    program
      .command(name)
      .description(description)
      .option('--expected-version <version>', systemDomainExpectedVersionDescription),
  ).action(async (options: SystemDomainVersionedCommandOptions): Promise<void> => {
    const result: SystemDomainMutationResponse = await runVersionedDomainMutation(options, mutate);
    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

async function runVersionedDomainMutation(
  options: SystemDomainVersionedCommandOptions,
  mutate: VersionedDomainMutation,
): Promise<SystemDomainMutationResponse> {
  const resolved: ResolvedSystemDomainVersionedCommand = resolveSystemDomainVersionedCommand(options);
  return await withResolvedKubernetesOperatorTarget(
    resolveKubernetesOperatorTarget(options),
    async (target: KubernetesOperatorTarget): Promise<SystemDomainMutationResponse> =>
      await mutate({
        ...target,
        ...(resolved.expectedSetupVersion === undefined ? {} : { expectedSetupVersion: resolved.expectedSetupVersion }),
      }),
  );
}
