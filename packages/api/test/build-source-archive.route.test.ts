import { workerClaimNextDeploymentPathname } from '@compartment/contracts';
import { issueBuildSourceArchiveCredential } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { readArtifactSourceArchive } from '../src/services/artifact-source-archive.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type ReadArtifactSourceArchive = typeof readArtifactSourceArchive;
const readArchiveMock: Mock<ReadArtifactSourceArchive> = vi.hoisted(
  (): Mock<ReadArtifactSourceArchive> => vi.fn<ReadArtifactSourceArchive>(),
);

interface ArtifactSourceArchiveServiceModule {
  ArtifactSourceArchiveNotFoundError: new (artifactId: string) => Error;
  readArtifactSourceArchive: Mock<ReadArtifactSourceArchive>;
}

vi.mock(
  '../src/services/artifact-source-archive.service',
  (): ArtifactSourceArchiveServiceModule => ({
    ArtifactSourceArchiveNotFoundError: class extends Error {},
    readArtifactSourceArchive: readArchiveMock,
  }),
);

const runtimeControlToken: string = 'test-runtime-control-token';
const archive: Buffer = Buffer.from('tenant source archive', 'utf8');

describe('build source archive route', (): void => {
  afterEach((): void => {
    readArchiveMock.mockReset();
  });

  it('refuses the installation runtime control token that build Pods used to carry', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await getSourceArchive(app, 'art_a', runtimeControlToken);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'build_source_archive_unauthorized' } });
      expect(readArchiveMock).not.toHaveBeenCalled();
    });
  });

  it("refuses one build's credential when it asks for another build's artifact", async (): Promise<void> => {
    applyApiRouteTestEnv();
    readArchiveMock.mockResolvedValue(archive);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const credential: string = issueCredential('art_a');

      const own: LightMyRequestResponse = await getSourceArchive(app, 'art_a', credential);
      const foreign: LightMyRequestResponse = await getSourceArchive(app, 'art_b', credential);

      expect(own.statusCode).toBe(200);
      expect(foreign.statusCode).toBe(401);
      expect(readArchiveMock).toHaveBeenCalledExactlyOnceWith('art_a');
    });
  });

  it('refuses a credential that has passed its expiry', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const expired: string = issueBuildSourceArchiveCredential(
        runtimeControlToken,
        'art_a',
        Math.floor(Date.now() / 1_000) - 1,
      );

      const response: LightMyRequestResponse = await getSourceArchive(app, 'art_a', expired);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'build_source_archive_unauthorized' } });
      expect(readArchiveMock).not.toHaveBeenCalled();
    });
  });

  it('refuses a credential minted under another installation secret', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await getSourceArchive(
        app,
        'art_a',
        issueBuildSourceArchiveCredential('another-installation-token', 'art_a', expiryFromNow()),
      );

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'build_source_archive_unauthorized' } });
      expect(readArchiveMock).not.toHaveBeenCalled();
    });
  });

  it('does not let a build credential reach any other internal worker route', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${issueCredential('art_a')}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        payload: JSON.stringify({ claimTimeoutMs: 1_000 }),
        timeoutMs: 1_000,
        url: workerClaimNextDeploymentPathname,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'internal_worker_unauthorized' } });
    });
  });

  it('serves the archive only for the artifact its credential pins', async (): Promise<void> => {
    applyApiRouteTestEnv();
    readArchiveMock.mockResolvedValueOnce(archive);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await getSourceArchive(app, 'art_a', issueCredential('art_a'));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/gzip');
      expect(response.rawPayload.equals(archive)).toBe(true);
      expect(readArchiveMock).toHaveBeenCalledExactlyOnceWith('art_a');
    });
  });
});

function issueCredential(artifactId: string): string {
  return issueBuildSourceArchiveCredential(runtimeControlToken, artifactId, expiryFromNow());
}

function expiryFromNow(): number {
  return Math.floor(Date.now() / 1_000) + 600;
}

async function getSourceArchive(app: ApiApp, artifactId: string, token: string): Promise<LightMyRequestResponse> {
  return await injectApiRoute(app, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    method: 'GET',
    timeoutMs: 1_000,
    url: `/internal/artifacts/${artifactId}/source-archive`,
  });
}
