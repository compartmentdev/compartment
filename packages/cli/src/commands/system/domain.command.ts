import type {
  DomainPublicScheme,
  SystemDomainMutationResponse,
  SystemDomainStatusResponse,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import {
  activateSelfHostedSystemDomain,
  attachSelfHostedSystemDomainCertificate,
  getSelfHostedSystemDomainStatus,
  setSelfHostedSystemDomain,
  verifySelfHostedSystemDomain,
} from '../../system-domain';
import { resetManagedSelfHostedSystemDomain } from '../../system-domain-managed-reset';
import type { VersionedSelfHostedSystemDomainInput } from '../../system-domain.types';
import type { CliCommandDependencies } from '../command.types';
import { createSelfHostedCommandContext } from '../self-hosted.command.context';
import { createSelfHostedProgressReporter } from '../self-hosted.command.progress';
import {
  createSystemDomainMutationMessage,
  createSystemDomainStatusMessage,
  readExpectedDomainSetupVersion,
  readSystemDomainPublicScheme,
  readSystemDomainTlsMode,
} from './domain.command.helpers';
import { executeSelfHostedSystemCommandWithSudoFallback } from './system.command.sudo';
import type {
  SystemDomainAttachCertificateCommandOptions,
  SystemDomainSetCommandOptions,
  SystemDomainStatusCommandOptions,
  SystemDomainVersionedCommandOptions,
} from './system.command.types';

export function registerDomainSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  const domainCommand: Command = program.command('domain').description('System domain commands');
  registerDomainStatusCommand(domainCommand, dependencies);
  registerDomainSetCommand(domainCommand, dependencies);
  registerDomainAttachCertificateCommand(domainCommand, dependencies);
  registerDomainVerifyCommand(domainCommand, dependencies);
  registerDomainActivateCommand(domainCommand, dependencies);
  registerDomainResetManagedCommand(domainCommand, dependencies);
}

function registerDomainStatusCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('status')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainStatusCommandOptions): Promise<void> =>
        await executeDomainStatusCommand(dependencies, options),
    );
}

function registerDomainSetCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('set')
    .description('Stage a whole-install custom domain and print required TXT and ingress records')
    .requiredOption('--base-domain <domain>', 'base domain, for example customer.example.com')
    .option('--public-scheme <scheme>', 'https', 'https')
    .option('--tls <mode>', 'external or custom-cert', 'external')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainSetCommandOptions): Promise<void> =>
        await executeDomainSetCommand(dependencies, options),
    );
}

function registerDomainAttachCertificateCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('attach-cert')
    .requiredOption('--cert-file <path>', 'full-chain PEM certificate file')
    .requiredOption('--key-file <path>', 'private key PEM file')
    .option('--expected-version <version>', 'domain setup version')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainAttachCertificateCommandOptions): Promise<void> =>
        await executeDomainAttachCertificateCommand(dependencies, options),
    );
}

function registerDomainVerifyCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('verify')
    .description('Verify ownership TXT plus direct install binding; proxied or CDN-masked DNS is not accepted')
    .option('--expected-version <version>', 'domain setup version')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainVersionedCommandOptions): Promise<void> =>
        await executeDomainMutationCommand(dependencies, options, verifySelfHostedSystemDomain),
    );
}

function registerDomainActivateCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('activate')
    .description('Re-verify the pending domain, apply runtime, and finalize activation')
    .option('--expected-version <version>', 'domain setup version')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainVersionedCommandOptions): Promise<void> =>
        await executeDomainMutationCommand(dependencies, options, activateSelfHostedSystemDomain),
    );
}

function registerDomainResetManagedCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('reset-managed')
    .option('--expected-version <version>', 'domain setup version')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemDomainVersionedCommandOptions): Promise<void> =>
        await executeDomainMutationCommand(dependencies, options, resetManagedSelfHostedSystemDomain),
    );
}

async function executeDomainStatusCommand(
  dependencies: CliCommandDependencies,
  options: SystemDomainStatusCommandOptions,
): Promise<void> {
  await executeSelfHostedSystemCommandWithSudoFallback(dependencies, async (): Promise<void> => {
    const result: SystemDomainStatusResponse = await getSelfHostedSystemDomainStatus();

    renderOutput(dependencies.io, options.output, result, createSystemDomainStatusMessage(result));
  });
}

async function executeDomainSetCommand(
  dependencies: CliCommandDependencies,
  options: SystemDomainSetCommandOptions,
): Promise<void> {
  const publicScheme: DomainPublicScheme = readSystemDomainPublicScheme(options.publicScheme);
  const tlsMode: 'custom-cert' | 'external' = readSystemDomainTlsMode(options.tls);
  assertDomainSetBrowserScheme(publicScheme);
  await executeSelfHostedSystemCommandWithSudoFallback(dependencies, async (): Promise<void> => {
    const result: SystemDomainMutationResponse = await setSelfHostedSystemDomain({
      baseDomain: options.baseDomain,
      context: createSelfHostedCommandContext(dependencies, createSelfHostedProgressReporter(dependencies)),
      publicScheme,
      tlsMode,
    });

    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

function assertDomainSetBrowserScheme(publicScheme: DomainPublicScheme): void {
  if (publicScheme !== 'https') {
    throw new Error('Expected --public-scheme to be https for browser auth cookies.');
  }
}

async function executeDomainAttachCertificateCommand(
  dependencies: CliCommandDependencies,
  options: SystemDomainAttachCertificateCommandOptions,
): Promise<void> {
  const expectedSetupVersion: number | undefined = readExpectedDomainSetupVersion(options.expectedVersion);
  await executeSelfHostedSystemCommandWithSudoFallback(dependencies, async (): Promise<void> => {
    const result: SystemDomainMutationResponse = await attachSelfHostedSystemDomainCertificate({
      certificateFile: options.certFile,
      context: createSelfHostedCommandContext(dependencies, createSelfHostedProgressReporter(dependencies)),
      expectedSetupVersion,
      privateKeyFile: options.keyFile,
    });

    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}

async function executeDomainMutationCommand(
  dependencies: CliCommandDependencies,
  options: SystemDomainVersionedCommandOptions,
  mutate: (input: VersionedSelfHostedSystemDomainInput) => Promise<SystemDomainMutationResponse>,
): Promise<void> {
  const expectedSetupVersion: number | undefined = readExpectedDomainSetupVersion(options.expectedVersion);
  await executeSelfHostedSystemCommandWithSudoFallback(dependencies, async (): Promise<void> => {
    const result: SystemDomainMutationResponse = await mutate({
      context: createSelfHostedCommandContext(dependencies, createSelfHostedProgressReporter(dependencies)),
      expectedSetupVersion,
    });

    renderOutput(dependencies.io, options.output, result, createSystemDomainMutationMessage(result));
  });
}
