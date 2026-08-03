import { isIP } from 'node:net';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';
import type { RegistryService } from './kubernetes-install-registry-service.service.types';

export async function readRegistryServiceAddresses(input: KubernetesInstallDeploymentInput): Promise<string[]> {
  const serviceName: string = `${input.chartFullname}-registry-auth`;
  const result: CommandResult = await runCommand(
    buildKubectlCommand(input, [
      '--request-timeout=5s',
      'get',
      `service/${serviceName}`,
      '--namespace',
      input.namespace,
      '-o=json',
    ]),
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure('Cannot inspect the retained registry-auth Service', result));
  }
  const addresses: string[] = parseRegistryServiceAddresses(result.stdout);
  if (addresses.length === 0) {
    throw new Error(`Retained registry-auth Service ${input.namespace}/${serviceName} has no usable ClusterIP.`);
  }
  return addresses;
}

export function assertRegistryServiceAddress(registryAddress: string, serviceAddresses: readonly string[]): void {
  if (serviceAddresses.includes(registryAddress)) {
    return;
  }
  throw new Error(
    `Private registry address ${registryAddress} does not match the retained registry-auth Service addresses: ${serviceAddresses.join(', ')}. Re-run installation to rotate the retained registry identity.`,
  );
}

function parseRegistryServiceAddresses(output: string): string[] {
  try {
    const service: RegistryService = JSON.parse(output) as RegistryService;
    const addresses: string[] = service.spec?.clusterIPs ?? [service.spec?.clusterIP ?? ''];
    return addresses.filter((address: string): boolean => isIP(address) === 4);
  } catch {
    throw new Error('Retained registry-auth Service inspection returned invalid JSON.');
  }
}
