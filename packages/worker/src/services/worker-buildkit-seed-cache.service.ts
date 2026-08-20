import type { WorkerBuildKitSeedConfig } from '../config.types';
import type { WorkerBuildKitSeedResolution } from './worker-buildkit-seed-cache.service.types';

const seedCacheProbeTimeoutMs: number = 2_000;

export async function resolveWorkerBuildKitSeedImage(
  seed: WorkerBuildKitSeedConfig,
): Promise<WorkerBuildKitSeedResolution> {
  try {
    const response: Response = await fetch(seed.cache.manifestUrl, {
      headers: {
        accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.docker.distribution.manifest.v2+json',
        ].join(', '),
      },
      method: 'HEAD',
      signal: AbortSignal.timeout(seedCacheProbeTimeoutMs),
    });
    if (response.ok) {
      return { cacheAvailable: true, image: seed.cache.image };
    }
  } catch {
    // A cache outage degrades locality, not build availability.
  }

  return { cacheAvailable: false, image: seed.image };
}
