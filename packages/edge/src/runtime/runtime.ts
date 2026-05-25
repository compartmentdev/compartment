import type { EdgeConfig } from '../config';

interface EdgeRuntimeState {
  config: EdgeConfig | null;
}

const runtimeState: EdgeRuntimeState = {
  config: null,
};

export function configureEdgeRuntime(config: EdgeConfig): void {
  runtimeState.config = config;
}

export function clearEdgeRuntime(): void {
  runtimeState.config = null;
}

export function getEdgeConfig(): EdgeConfig {
  if (runtimeState.config === null) {
    throw new Error('Edge runtime is not configured.');
  }

  return runtimeState.config;
}
