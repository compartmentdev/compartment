import { describe, expect, it } from 'vitest';
import {
  buildGitSourceBindingAuditMetadata,
  buildOrganizationAssignmentAuditMetadata,
  buildSsoOidcProviderAuditMetadata,
  sanitizeAuditEventMetadata,
} from '../src/services/audit-event-metadata.service';

describe('audit event metadata service', (): void => {
  it('keeps assignment metadata to an allowlisted shape', (): void => {
    expect(
      buildOrganizationAssignmentAuditMetadata({
        roleName: 'Deployer',
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          groupId: 'grp_123',
          groupName: 'Deployers',
          subjectType: 'group',
        },
      }),
    ).toEqual({
      roleName: 'Deployer',
      scopeType: 'project',
      subjectType: 'group',
    });
  });

  it('keeps SSO and Git metadata to allowlisted non-secret facts', (): void => {
    expect(buildSsoOidcProviderAuditMetadata({ key: 'google', preset: 'google' })).toEqual({
      key: 'google',
      preset: 'google',
    });
    expect(
      buildGitSourceBindingAuditMetadata({
        autoDeployEnabled: true,
        branchName: 'main',
        descriptorPath: 'apps/billing/compartment.yml',
        environmentName: 'production',
        projectName: 'billing',
      }),
    ).toEqual({
      autoDeployEnabled: true,
      branchName: 'main',
      descriptorPath: 'apps/billing/compartment.yml',
      environmentName: 'production',
      projectName: 'billing',
    });
  });

  it('rejects secret-shaped metadata keys', (): void => {
    expect((): void => {
      sanitizeAuditEventMetadata({
        tokenHash: 'never-store-this',
      });
    }).toThrow('forbidden');
    expect((): void => {
      sanitizeAuditEventMetadata({
        client_secret: 'never-store-this',
      });
    }).toThrow('forbidden');
  });
});
