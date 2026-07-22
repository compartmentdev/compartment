import type { CliIo } from '../app.types';
import type { KubernetesRegistryMirrorApplyResult } from '../services/kubernetes-registry-mirror.service.types';

export function renderRegistryMirrorApplyResult(io: CliIo, result: KubernetesRegistryMirrorApplyResult): void {
  if (result.configChanged) {
    io.stderr('Updated /etc/rancher/k3s/registries.yaml with the installed registry endpoint.\n');
  } else {
    io.stderr('The registry mirror file is already current.\n');
  }
  if (result.configChanged) {
    if (result.restartError === undefined) {
      io.stderr('Restarted k3s after applying the registry mirror.\n');
    } else {
      io.stderr(`Warning: k3s did not restart: ${result.restartError}\n`);
    }
  }
  if (!result.current) {
    io.stderr('Warning: /etc/rancher/k3s/registries.yaml does not contain the current registry Service IP.\n');
  }
}
