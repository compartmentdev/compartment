import type { Command } from 'commander';
import type { CliInstallResult } from '../../install.types';
import { installDev } from '../../install';
import type { CliCommandDependencies } from '../command.types';
import { buildOwnerInstallInput, resolveInstallIdentityPrompts } from './install.command.identity';
import { renderInstallResult } from './install.command.result';
import { persistDevInstallSession } from './install.command.session';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';
import { assertDevInstallOptions } from './install.command.validation';
import { executeCanonicalKubernetesInstallCommand } from './install.command.kubernetes';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = program
    .command('install')
    .option('--dev', 'Install against the local repo dev API')
    .option('--api-url <url>', 'Public Console URL for the Kubernetes installation')
    .option('--base-domain <domain>', 'Base domain configured for the Kubernetes installation')
    .option('--managed-domain', 'Allocate a managed installation domain (default when --base-domain is omitted)')
    .option('--broker-url <url>', 'Managed-domain broker URL')
    .option('--chart <path>', 'Compartment Helm chart path for a source CLI build')
    .option('--kube-context <name>', 'Kubernetes context for Helm')
    .option('--namespace <name>', 'Kubernetes namespace; defaults to compartment')
    .option('--release-name <name>', 'Helm release name; defaults to compartment')
    .option('--email <email>', 'First admin email')
    .option('--admin-password <password>', 'First admin password (automation only)')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for the saved CLI session')
    .option('--output <format>', 'text or json', 'text');
  addCanonicalInstallOptions(command).action(
    async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
  );
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

  await executeCanonicalKubernetesInstallCommand(dependencies, options);
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
