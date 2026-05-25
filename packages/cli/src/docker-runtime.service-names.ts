import type { SystemServiceName } from '@compartment/contracts';

export const selfHostedCoreRuntimeServiceNames: readonly SystemServiceName[] = [
  'api',
  'registry',
  'registry-auth',
  'edge',
  'caddy',
];
export const selfHostedBuildRuntimeServiceNames: readonly SystemServiceName[] = ['builder', 'worker'];
export const selfHostedRequiredSystemComposeServiceNames: readonly SystemServiceName[] = [
  ...selfHostedCoreRuntimeServiceNames,
  'postgres',
];
export const selfHostedComposeServiceNames: readonly SystemServiceName[] = [
  'api',
  'registry',
  'registry-auth',
  'edge',
  'builder',
  'worker',
  'caddy',
  'postgres',
];
export const selfHostedSystemServiceNames: readonly SystemServiceName[] = [
  'api',
  'registry',
  'registry-auth',
  'edge',
  'node',
  'builder',
  'worker',
  'caddy',
  'postgres',
];

export function readSelfHostedSystemServiceNames(): readonly SystemServiceName[] {
  return selfHostedSystemServiceNames;
}
