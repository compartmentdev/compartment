import { describe, expect, it } from 'vitest';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type { SourceRow } from '../src/queries/source.query.types';
import { buildClaimedTaskProviderFields } from '../src/services/git-source/git-source-resolution-worker.support';

describe('claimed git-source task provider fields', (): void => {
  it('adds provider identity to GitHub claims', (): void => {
    expect(buildClaimedTaskProviderFields(createRegistration('github_app'), createSource())).toEqual({
      providerType: 'github_app',
      repositoryExternalId: '42',
    });
  });

  it('adds provider identity to GitLab claims', (): void => {
    expect(buildClaimedTaskProviderFields(createRegistration('gitlab'), createSource())).toEqual({
      providerType: 'gitlab',
      repositoryExternalId: '42',
    });
  });
});

function createRegistration(providerType: 'github_app' | 'gitlab'): GitProviderRegistrationRow {
  return { providerType } as GitProviderRegistrationRow;
}

function createSource(): SourceRow {
  return { repositoryExternalId: '42' } as SourceRow;
}
