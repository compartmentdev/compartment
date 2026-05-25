import { describe, expect, it } from 'vitest';

import {
  buildCompartmentResourceLogsPathname,
  buildCompartmentResourcePathname,
  buildCompartmentResourceRestorePathname,
  buildCompartmentResourceStartPathname,
  buildCompartmentResourceStopPathname,
  buildCompartmentVariableBindingPathname,
  buildCompartmentVariableGroupPathname,
  buildCompartmentVariableGroupUsagesPathname,
  buildCompartmentVariablePathname,
  compartmentAuthSettingsPathname,
  compartmentDeploymentsInspectPathname,
  compartmentDeploymentsPromotePathname,
  compartmentDeploymentsStatusPathname,
  compartmentResourceLogsPathnameTemplate,
  compartmentResourcePathnameTemplate,
  compartmentResourceRestorePathnameTemplate,
  compartmentResourceStartPathnameTemplate,
  compartmentResourceStopPathnameTemplate,
  compartmentVariableBindingPathnameTemplate,
  compartmentVariableGroupCapturePathname,
  compartmentVariableGroupImportPathname,
  compartmentVariableGroupPathnameTemplate,
  compartmentVariableGroupsPathname,
  compartmentVariableGroupUsagesPathnameTemplate,
  compartmentVariableGroupVariablesPathname,
  compartmentVariablePathnameTemplate,
} from '../src';
import {
  buildCompartmentConsoleAssetPathname,
  buildCompartmentConsoleOrganizationProjectDeploymentDetailsPathname,
  buildCompartmentConsoleOrganizationProjectsPathname,
  buildCompartmentConsoleOrganizationScopedPathname,
  compartmentBrowserProjectCreatePathname,
  compartmentConsoleOrganizationProjectCreatePathnameTemplate,
  compartmentConsoleOrganizationProjectDeploymentDetailsPathnameTemplate,
  compartmentConsoleOrganizationProjectDeploymentsPathnameTemplate,
  compartmentConsoleOrganizationProjectOverviewPathnameTemplate,
  compartmentConsoleOrganizationProjectsPathnameTemplate,
} from '../src/index.browser';

describe('control-plane protocol helpers', (): void => {
  it('exports public API path constants used by the control-plane host', (): void => {
    expect(compartmentAuthSettingsPathname).toBe('/v1/auth/settings');
    expect(compartmentDeploymentsStatusPathname).toBe('/v1/deployments/status');
    expect(compartmentDeploymentsInspectPathname).toBe('/v1/deployments/inspect');
    expect(compartmentDeploymentsPromotePathname).toBe('/v1/deployments/promote');
    expect(compartmentResourcePathnameTemplate).toBe('/v1/resources/:resourceName');
    expect(compartmentResourceLogsPathnameTemplate).toBe('/v1/resources/:resourceName/logs');
    expect(compartmentResourceRestorePathnameTemplate).toBe('/v1/resources/:resourceName/restore');
    expect(compartmentResourceStartPathnameTemplate).toBe('/v1/resources/:resourceName/start');
    expect(compartmentResourceStopPathnameTemplate).toBe('/v1/resources/:resourceName/stop');
    expect(compartmentVariablePathnameTemplate).toBe('/v1/variables/:keyName');
    expect(compartmentVariableBindingPathnameTemplate).toBe('/v1/variables/bindings/:variableGroupName');
    expect(compartmentVariableGroupsPathname).toBe('/v1/variable-groups');
    expect(compartmentVariableGroupCapturePathname).toBe('/v1/variable-groups/capture');
    expect(compartmentVariableGroupImportPathname).toBe('/v1/variable-groups/import');
    expect(compartmentVariableGroupPathnameTemplate).toBe('/v1/variable-groups/:variableGroupName');
    expect(compartmentVariableGroupUsagesPathnameTemplate).toBe('/v1/variable-groups/:variableGroupName/usages');
    expect(compartmentVariableGroupVariablesPathname).toBe('/v1/variable-groups/variables');
  });

  it('builds public API pathnames with encoded path segments', (): void => {
    expect(buildCompartmentResourcePathname('main db')).toBe('/v1/resources/main%20db');
    expect(buildCompartmentResourceLogsPathname('main db')).toBe('/v1/resources/main%20db/logs');
    expect(buildCompartmentResourceRestorePathname('main db')).toBe('/v1/resources/main%20db/restore');
    expect(buildCompartmentResourceStartPathname('main db')).toBe('/v1/resources/main%20db/start');
    expect(buildCompartmentResourceStopPathname('main db')).toBe('/v1/resources/main%20db/stop');
    expect(buildCompartmentVariablePathname('API KEY')).toBe('/v1/variables/API%20KEY');
    expect(buildCompartmentVariableBindingPathname('production env')).toBe('/v1/variables/bindings/production%20env');
    expect(buildCompartmentVariableGroupPathname('production env')).toBe('/v1/variable-groups/production%20env');
    expect(buildCompartmentVariableGroupUsagesPathname('production env')).toBe(
      '/v1/variable-groups/production%20env/usages',
    );
  });

  it('builds browser asset paths with encoded path segments', (): void => {
    expect(buildCompartmentConsoleAssetPathname('/assets/browser chunk.js')).toBe(
      '/browser-assets/assets/browser%20chunk.js',
    );
    expect(buildCompartmentConsoleAssetPathname('\\assets\\browser.js')).toBe('/browser-assets/assets/browser.js');
  });

  it('exports canonical organization-scoped browser path templates', (): void => {
    expect(compartmentBrowserProjectCreatePathname).toBe('/projects/create');
    expect(compartmentConsoleOrganizationProjectsPathnameTemplate).toBe('/orgs/:organizationSlug/projects');
    expect(compartmentConsoleOrganizationProjectCreatePathnameTemplate).toBe('/orgs/:organizationSlug/projects/create');
    expect(compartmentConsoleOrganizationProjectOverviewPathnameTemplate).toBe(
      '/orgs/:organizationSlug/projects/:projectName',
    );
    expect(compartmentConsoleOrganizationProjectDeploymentsPathnameTemplate).toBe(
      '/orgs/:organizationSlug/projects/:projectName/deployments',
    );
    expect(compartmentConsoleOrganizationProjectDeploymentDetailsPathnameTemplate).toBe(
      '/orgs/:organizationSlug/projects/:projectName/deployments/:deploymentRunId',
    );
  });

  it('builds canonical organization-scoped browser paths with encoded segments', (): void => {
    expect(buildCompartmentConsoleOrganizationProjectsPathname('acme dev')).toBe('/orgs/acme%20dev/projects');
    expect(buildCompartmentConsoleOrganizationScopedPathname('acme dev', '/users')).toBe('/orgs/acme%20dev/users');
    expect(buildCompartmentConsoleOrganizationScopedPathname('acme dev', '/groups')).toBe('/orgs/acme%20dev/groups');
    expect(buildCompartmentConsoleOrganizationScopedPathname('acme dev', '/roles')).toBe('/orgs/acme%20dev/roles');
    expect(buildCompartmentConsoleOrganizationScopedPathname('acme dev', '/audit')).toBe('/orgs/acme%20dev/audit');
    expect(buildCompartmentConsoleOrganizationScopedPathname('acme dev', '/onboarding')).toBe(
      '/orgs/acme%20dev/onboarding',
    );
    expect(
      buildCompartmentConsoleOrganizationProjectDeploymentDetailsPathname('acme dev', 'billing app', 'run 123'),
    ).toBe('/orgs/acme%20dev/projects/billing%20app/deployments/run%20123');
  });

  it('rejects dot-segment asset paths', (): void => {
    expect((): string => buildCompartmentConsoleAssetPathname('../browser.js')).toThrow(
      'Invalid control-plane asset path segment: ..',
    );
    expect((): string => buildCompartmentConsoleAssetPathname('./browser.js')).toThrow(
      'Invalid control-plane asset path segment: .',
    );
  });
});
