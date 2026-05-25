export const cliTestEdgeToken: string = 'test-edge-token';
export const cliTestRuntimeControlToken: string = 'test-runtime-control-token';
export const cliTestSessionSecret: string = 'test-secret';
export const cliTestSystemToken: string = 'test-system-token';

const cliTestSessionTtlMs: number = 7 * 24 * 60 * 60 * 1000;

export function readCliTestSessionTtlDuration(): string {
  return `${Math.floor(cliTestSessionTtlMs / (24 * 60 * 60 * 1000)).toString()}d`;
}

export function readCliTestVariablesMasterKeyHex(): string {
  return '11'.repeat(32);
}
