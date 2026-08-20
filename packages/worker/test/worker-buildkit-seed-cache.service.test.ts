import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerBuildKitSeedConfig } from '../src/config.types';
import { resolveWorkerBuildKitSeedImage } from '../src/services/worker-buildkit-seed-cache.service';

const sourceImage: string = `ghcr.io/compartmentdev/compartment-buildkit-seed@sha256:${'a'.repeat(64)}`;
const cacheImage: string = `10.43.0.20/compartmentdev/compartment-buildkit-seed@sha256:${'a'.repeat(64)}`;

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('resolveWorkerBuildKitSeedImage', (): void => {
  it('selects the digest-identical LAN reference when its manifest is available', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(new Response(null, { status: 200 }))),
    );

    await expect(resolveWorkerBuildKitSeedImage(seedConfig())).resolves.toEqual({
      cacheAvailable: true,
      image: cacheImage,
    });
  });

  it('selects the verified public reference when the cache probe fails', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(new Response(null, { status: 503 }))),
    );

    await expect(resolveWorkerBuildKitSeedImage(seedConfig())).resolves.toEqual({
      cacheAvailable: false,
      image: sourceImage,
    });
  });

  function seedConfig(): WorkerBuildKitSeedConfig {
    return {
      cache: {
        image: cacheImage,
        manifestUrl: `http://compartment-buildkit-seed-cache:5003/v2/compartmentdev/compartment-buildkit-seed/manifests/sha256:${'a'.repeat(64)}`,
      },
      image: sourceImage,
      railpackBuilderImage: `ghcr.io/railwayapp/railpack-builder@sha256:${'b'.repeat(64)}`,
      railpackRuntimeImage: `ghcr.io/railwayapp/railpack-runtime@sha256:${'c'.repeat(64)}`,
    };
  }
});
