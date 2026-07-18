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
import type { KubernetesDomainVersionedInput } from '../../services/kubernetes-operator.service.types';
import type { CliCommandDependencies } from '../command.types';
import {
  addKubernetesOperatorReleaseOptions,
  addKubernetesOperatorTargetOptions,
  readSystemDomainBaseDomain,
  readSystemDomainTlsMode,
  resolveKubernetesOperatorTarget,
  resolveSystemDomainVersionedCommand,
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
    const result: SystemDomainStatusResponse = await getKubernetesSystemDomainStatus(
      resolveKubernetesOperatorTarget(options),
    );
    renderOutput(dependencies.io, options.output, result, createSystemDomainStatusMessage(result));
  });
}

function registerDomainSetCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorTargetOptions(
    program
      .command('set')
      .description('Stage a custom system domain and print required DNS records')
      .requiredOption('--base-domain <domain>', 'Public base domain')
      .option('--tls <mode>', 'external or custom-cert', 'external'),
  ).action(async (options: SystemDomainSetCommandOptions): Promise<void> => {
    const result: SystemDomainMutationResponse = await setKubernetesSystemDomain({
      ...resolveKubernetesOperatorTarget(options),
      baseDomain: readSystemDomainBaseDomain(options.baseDomain),
      tlsMode: readSystemDomainTlsMode(options.tls),
    });
    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

function registerDomainAttachCertificateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addKubernetesOperatorReleaseOptions(
    program
      .command('attach-cert')
      .description('Stage a TLS Secret and validate it against the pending domain')
      .requiredOption('--cert-file <path>', 'Full-chain PEM certificate file')
      .requiredOption('--key-file <path>', 'Private-key PEM file')
      .option('--expected-version <version>', 'Domain setup version from 0 to 2147483647'),
  ).action(async (options: SystemDomainAttachCertificateCommandOptions): Promise<void> => {
    const resolved: ResolvedSystemDomainVersionedCommand = resolveSystemDomainVersionedCommand(options);
    const result: SystemDomainMutationResponse = await attachKubernetesSystemDomainCertificate({
      ...resolved.target,
      ...(resolved.expectedSetupVersion === undefined ? {} : { expectedSetupVersion: resolved.expectedSetupVersion }),
      certificateFile: options.certFile,
      privateKeyFile: options.keyFile,
    });
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
      .option('--expected-version <version>', 'Domain setup version from 0 to 2147483647'),
  ).action(async (options: SystemDomainVersionedCommandOptions): Promise<void> => {
    const resolved: ResolvedSystemDomainVersionedCommand = resolveSystemDomainVersionedCommand(options);
    const result: SystemDomainMutationResponse = await mutate({
      ...resolved.target,
      ...(resolved.expectedSetupVersion === undefined ? {} : { expectedSetupVersion: resolved.expectedSetupVersion }),
    });
    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}
