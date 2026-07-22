import type { CliIo } from '../../app.types';
import { promptYesNoChoice } from '../../prompts/prompt';
import { isInteractivePromptInput } from '../../prompts/prompt-reader';
import {
  applyKubernetesRegistryMirror,
  canAutoApplyKubernetesRegistryMirror,
  renderKubernetesRegistryMirrorInstructions,
} from '../../services/kubernetes-registry-mirror.service';
import type { KubernetesRegistryMirror } from '../../services/kubernetes-registry-mirror.service.types';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';
import { renderRegistryMirrorApplyResult } from '../registry-mirror.output';

export async function finishInstallRegistryMirrorSetup(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
  skipAutoApply: boolean,
): Promise<void> {
  io.stderr(renderKubernetesRegistryMirrorInstructions(mirror));
  if (await shouldAutoApplyRegistryMirror(io, target, skipAutoApply)) {
    await applyAndRenderRegistryMirror(io, mirror);
  }
}

async function shouldAutoApplyRegistryMirror(
  io: CliIo,
  target: KubernetesOperatorTarget,
  skipAutoApply: boolean,
): Promise<boolean> {
  if (skipAutoApply) {
    io.stderr('Automatic registry mirror setup was skipped by --skip-registry-mirror.\n');
    return false;
  }
  if (!(await canAutoApplyKubernetesRegistryMirror(target))) {
    io.stderr('Automatic registry mirror setup is unavailable; follow the instructions on every k3s node.\n');
    return false;
  }
  if (!isInteractivePromptInput(io.stdin)) {
    io.stderr('Applying the registry mirror automatically on the local k3s node.\n');
    return true;
  }
  return await promptYesNoChoice(io, 'Apply this registry mirror on the local k3s node now? [Y/n]: ', true);
}

async function applyAndRenderRegistryMirror(io: CliIo, mirror: KubernetesRegistryMirror): Promise<void> {
  try {
    renderRegistryMirrorApplyResult(io, await applyKubernetesRegistryMirror(mirror));
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    io.stderr(`Warning: automatic registry mirror setup failed: ${message}\n`);
    io.stderr('Complete the printed registry mirror instructions before the first deploy.\n');
  }
}
