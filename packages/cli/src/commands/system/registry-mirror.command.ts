import type { Command } from 'commander';
import { renderRegistryMirrorApplyResult } from '../registry-mirror.output';
import { createKubernetesRegistryMirrorFromHost } from '../../services/kubernetes-registry-mirror-config.service';
import { applyKubernetesRegistryMirror } from '../../services/kubernetes-registry-mirror.service';
import type {
  KubernetesRegistryMirror,
  KubernetesRegistryMirrorApplyResult,
} from '../../services/kubernetes-registry-mirror.service.types';
import type { CliCommandDependencies } from '../command.types';
import type { RegistryMirrorApplyCommandOptions } from './system.command.types';

export function registerRegistryMirrorSystemCommands(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('registry-mirror')
    .description('Manage the local k3s registry mirror')
    .command('apply')
    .description('Merge a registry mirror into the local k3s config and restart k3s')
    .requiredOption('--registry-host <host>', 'Canonical registry-auth Service DNS host with port')
    .requiredOption('--cluster-ip <ipv4>', 'Current registry-auth Service ClusterIP')
    .action(async (options: RegistryMirrorApplyCommandOptions): Promise<void> => {
      const mirror: KubernetesRegistryMirror = createKubernetesRegistryMirrorFromHost(
        options.registryHost,
        options.clusterIp,
      );
      const result: KubernetesRegistryMirrorApplyResult = await applyKubernetesRegistryMirror(mirror);
      renderRegistryMirrorApplyResult(dependencies.io, result);
      assertRegistryMirrorApplyCompleted(result);
    });
}

function assertRegistryMirrorApplyCompleted(result: KubernetesRegistryMirrorApplyResult): void {
  if (result.restartError !== undefined) {
    throw new Error('Registry mirror was written, but k3s did not restart.');
  }
  if (!result.current) {
    throw new Error('Registry mirror post-check did not find the current registry Service IP.');
  }
}
