import { Option, type Command } from 'commander';
import type { CliInstallResult } from '../../install.types';
import { installDev } from '../../install';
import type { CliCommandDependencies } from '../command.types';
import { buildOwnerInstallInput, resolveInstallIdentityPrompts } from './install.command.identity';
import { renderInstallResult } from './install.command.result';
import { persistDevInstallSession } from './install.command.session';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';
import { assertDevInstallOptions } from './install.command.validation';
import { executeCanonicalKubernetesInstallCommand } from './install.command.kubernetes';
import { executeManagedVmInstallCommand } from './install.command.vm';
import type { InstallTargetDiscovery } from '../../services/managed-vm-target.service';
import { resolveInstallCommandTarget } from './install.command.target';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = addInstallIdentityOptions(
    program
      .command('install')
      .option('--dev', 'Install against the local repo dev API')
      .option('--api-url <url>', 'Public Console URL for the Kubernetes installation')
      .option('--base-domain <domain>', 'Base domain configured for the Kubernetes installation')
      .option('--managed-domain', 'Allocate a managed installation domain (default when --base-domain is omitted)')
      .option('--broker-url <url>', 'Managed-domain broker URL')
      .option('--values <path>', 'Operator values file for the Compartment Helm chart')
      .option('--chart <path>', 'Compartment Helm chart path for a source CLI build')
      .option('--kube-context <name>', 'Kubernetes context for Helm')
      .option('--namespace <name>', 'Kubernetes namespace; defaults to compartment')
      .option('--release-name <name>', 'Helm release name; defaults to compartment'),
  ).option('--output <format>', 'text or json', 'text');
  command
    .option('--target <target>', 'Installation target: vm or kubernetes')
    .option('--check', 'Run read-only target preflight without making changes')
    .option('--yes', 'Accept the rendered mutation review');
  command.addOption(new Option('--privileged-vm-install').hideHelp());
  command.addOption(new Option('--privileged-vm-handoff <path>').hideHelp());
  addCanonicalInstallOptions(command).action(
    async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
  );
}

function addInstallIdentityOptions(command: Command): Command {
  return command
    .option('--email <email>', 'First admin email')
    .option('--admin-password <password>', 'First admin password (automation only)')
    .option('--admin-password-file <path>', 'Read the first admin password from a protected file')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for the saved CLI session');
}

function addCanonicalInstallOptions(command: Command): Command {
  return command
    .option('--ingress-class <name>', 'IngressClass used for public Compartment hosts')
    .option('--storage-class <name>', 'StorageClass used for persistent platform data')
    .option('--ingress-endpoint <address>', 'Explicit ingress address when status is not published');
}

async function executeInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  if (options.dev === true) {
    await executeDevInstallCommand(dependencies, options);
    return;
  }

  const target: InstallTargetDiscovery = await resolveInstallCommandTarget(dependencies, options);
  if (target.target === 'vm') {
    await executeManagedVmInstallCommand(dependencies, options);
    return;
  }
  await executeCanonicalKubernetesInstallCommand(
    dependencies,
    options,
    target.kind === 'kubernetes' ? target : undefined,
  );
}

async function executeDevInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  assertDevInstallOptions(options);
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  const result: CliInstallResult = await installDev(buildOwnerInstallInput(prompts, options));

  await persistDevInstallSession(result, options.remote);
  renderInstallResult(dependencies.io, options.output, result, true);
}
