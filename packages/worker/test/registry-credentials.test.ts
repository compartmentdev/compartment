import { describe, expect, it } from 'vitest';
import {
  authorizeRegistryRequest,
  issueBuildPushCredential,
  issueProjectPullCredential,
  verifyRegistryCredential,
} from '../src/registry-credentials';
import type { RegistryCredential, RegistryCredentialPayload } from '../src/registry-credentials.types';

const signingKey: string = 'registry-signing-key-with-at-least-32-characters';
const repository: string = 'projects/prj_123/services/svc_123';

describe('project-scoped registry credentials', (): void => {
  it('rejects cross-project pull before registry access', (): void => {
    const credential: RegistryCredentialPayload = authenticate(issueProjectPullCredential(signingKey, 'prj_123'));

    expect(
      authorizeRegistryRequest(credential, 'GET', '/v2/projects/prj_456/services/svc_123/manifests/sha256:abc'),
    ).toBeNull();
  });

  it('rejects push with pull-only credentials', (): void => {
    const credential: RegistryCredentialPayload = authenticate(issueProjectPullCredential(signingKey, 'prj_123'));

    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/art_123`)).toBeNull();
  });

  it('allows an active build to write its tag and digest-addressed manifests in the exact repository', (): void => {
    const credential: RegistryCredentialPayload = authenticate(
      issueBuildPushCredential(signingKey, 'prj_123', repository, 'art_123', 100),
    );

    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/art_123`, 101)).not.toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/sha256:${'a'.repeat(64)}`, 101),
    ).not.toBeNull();
    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/build-cache`, 101)).not.toBeNull();
  });

  it('rejects writes outside the active build intent', (): void => {
    const credential: RegistryCredentialPayload = authenticate(
      issueBuildPushCredential(signingKey, 'prj_123', repository, 'art_123', 100),
    );
    const digest: string = `sha256:${'a'.repeat(64)}`;

    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/art_other`, 101)).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/build-cache-other`, 101),
    ).toBeNull();
    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/sha256:abc`, 101)).toBeNull();
    expect(authorizeRegistryRequest(credential, 'POST', `/v2/${repository}/manifests/${digest}`, 101)).toBeNull();
    expect(authorizeRegistryRequest(credential, 'PATCH', `/v2/${repository}/manifests/${digest}`, 101)).toBeNull();
    expect(authorizeRegistryRequest(credential, 'DELETE', `/v2/${repository}/manifests/${digest}`, 101)).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'PUT', `/v2/projects/prj_123/services/svc_other/manifests/${digest}`, 101),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'PUT', `/v2/projects/prj_456/services/svc_other/manifests/${digest}`, 101),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'GET', '/v2/projects/prj_123/services/svc_other/manifests/art_123', 101),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(
        credential,
        'POST',
        `/v2/${repository}/blobs/uploads/?mount=sha256:abc&from=projects/prj_456/services/svc_other`,
        101,
      ),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(
        credential,
        'POST',
        `/v2/${repository}/blobs/uploads/?mount=sha256:abc&from=projects/prj_123/services/svc_other`,
        101,
      ),
    ).toBeNull();
    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/art_123`, 3_701)).toBeNull();
    expect(authorizeRegistryRequest(credential, 'PUT', `/v2/${repository}/manifests/${digest}`, 3_701)).toBeNull();
    expect(authorizeRegistryRequest(credential, 'GET', `/v2/${repository}/manifests/art_123`, 3_701)).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'DELETE', `/v2/${repository}/blobs/sha256:${'a'.repeat(64)}`, 101),
    ).toBeNull();
    expect(authorizeRegistryRequest(credential, 'DELETE', `/v2/${repository}/manifests/art_123`, 101)).toBeNull();
  });

  it('has no mutable project or organization-name fallback', (): void => {
    expect(
      (): RegistryCredential =>
        issueBuildPushCredential(signingKey, 'my-project', 'projects/my-project/services/svc_web', 'art_123'),
    ).toThrow('projectId must be an immutable project identifier.');
    expect(
      (): RegistryCredential =>
        issueBuildPushCredential(signingKey, 'prj_123', 'organizations/acme/projects/prj_123/web', 'art_123'),
    ).toThrow('Registry repository must use the immutable project ID prefix.');
  });

  it('accepts encoded same-repository blob mount query values', (): void => {
    const credential: RegistryCredentialPayload = authenticate(
      issueBuildPushCredential(signingKey, 'prj_123', repository, 'art_123', 100),
    );
    expect(
      authorizeRegistryRequest(
        credential,
        'POST',
        `/v2/${repository}/blobs/uploads/?mount=sha256%3Aabc&from=projects%2Fprj_123%2Fservices%2Fsvc_123`,
        101,
      ),
    ).not.toBeNull();
  });

  it('allows digest reads but rejects encoded registry path segments', (): void => {
    const credential: RegistryCredentialPayload = authenticate(
      issueBuildPushCredential(signingKey, 'prj_123', repository, 'art_123', 100),
    );
    const digest: string = `sha256:${'a'.repeat(64)}`;

    expect(authorizeRegistryRequest(credential, 'GET', `/v2/${repository}/manifests/${digest}`, 101)).not.toBeNull();
    expect(authorizeRegistryRequest(credential, 'GET', `/v2/${repository}/blobs/${digest}`, 101)).not.toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'GET', `/v2/${repository}/manifests/sha256%3A${'a'.repeat(64)}`, 101),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'GET', `/v2/${repository}/blobs/sha256%3A${'a'.repeat(64)}`, 101),
    ).toBeNull();
  });

  it('rejects forged credential signatures', (): void => {
    const credential: RegistryCredential = issueProjectPullCredential(signingKey, 'prj_123');
    const authorization: string = `Basic ${Buffer.from(`${credential.username}:${credential.password}x`).toString('base64')}`;
    expect(verifyRegistryCredential(signingKey, authorization)).toBeNull();
  });

  it('rejects repository-prefix injection and encoded path separators', (): void => {
    const credential: RegistryCredentialPayload = authenticate(issueProjectPullCredential(signingKey, 'prj_123'));

    expect(
      authorizeRegistryRequest(
        credential,
        'GET',
        '/v2/projects/prj_123%2f..%2fprj_456/services/svc_123/manifests/latest',
      ),
    ).toBeNull();
    expect(
      authorizeRegistryRequest(credential, 'GET', '/v2/projects/prj_1234/services/svc_123/manifests/latest'),
    ).toBeNull();
  });
});

function authenticate(credential: RegistryCredential): RegistryCredentialPayload {
  const authorization: string = `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString(
    'base64',
  )}`;
  const payload: RegistryCredentialPayload | null = verifyRegistryCredential(signingKey, authorization);
  if (payload === null) {
    throw new Error('Expected issued credential to authenticate.');
  }
  return payload;
}
