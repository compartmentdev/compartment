import { describe, expect, it } from 'vitest';
import { createBuildJobAccessToken, parseBuildJobAccessToken } from '../src/routes/internal/build-job-access-token';

const secret: string = 'runtime-control-secret-with-at-least-32-characters';
const issuedAt: Date = new Date('2026-08-03T12:00:00.000Z');

describe('build Job access token', (): void => {
  it('binds an unexpired token to one artifact and deployment', (): void => {
    const token: string = createBuildJobAccessToken({
      artifactId: 'art_123',
      deploymentId: 'dep_123',
      now: issuedAt,
      secret,
    });

    expect(parseBuildJobAccessToken(token, secret, new Date('2026-08-03T12:59:59.000Z'))).toMatchObject({
      artifactId: 'art_123',
      deploymentId: 'dep_123',
    });
    expect(parseBuildJobAccessToken(token, `${secret}x`, issuedAt)).toBeNull();
  });

  it('rejects an expired token', (): void => {
    const token: string = createBuildJobAccessToken({
      artifactId: 'art_123',
      deploymentId: 'dep_123',
      now: issuedAt,
      secret,
    });

    expect(parseBuildJobAccessToken(token, secret, new Date('2026-08-03T13:00:00.001Z'))).toBeNull();
  });
});
