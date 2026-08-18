import type { KubernetesPlatformImageName } from './kubernetes-platform-image.types';

export const kubernetesPlatformImageNames: readonly KubernetesPlatformImageName[] = [
  'api',
  'buildkitSeed',
  'worker',
  'edge',
  'caddy',
  'dns01Solver',
];
