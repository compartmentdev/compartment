import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { listOverviewProjectRowsPageByOrganization } from '../src/queries/project-list.query';
import type { listProjectsByIds, listProjectsByOrganization } from '../src/queries/projects.query';
import type { ProjectRow } from '../src/queries/projects.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type { buildProjectOverviewSummaries } from '../src/services/project-list-overview.service';
import type { listVisibleProjectSummaries, VisibleProjectSummary } from '../src/services/project-visibility.service';
import type { buildProjectStatusSummaries } from '../src/services/project-list-status.service';
import type { resolveRequiredOrganization } from '../src/services/project-scope.service';
import { listProjectListForPrincipal } from '../src/services/project-list.service';
import { buildProjectSummaryListItem } from '../src/services/project-summary-list-item.service.helpers';
import type { ProjectListResult, ProjectSummaryListItem } from '../src/services/projects.service.types';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type BuildProjectOverviewSummaries = typeof buildProjectOverviewSummaries;
type BuildProjectStatusSummaries = typeof buildProjectStatusSummaries;
type GetApiConfig = typeof getApiConfig;
type ListOverviewProjectRowsPageByOrganization = typeof listOverviewProjectRowsPageByOrganization;
type ListProjectsByIds = typeof listProjectsByIds;
type ListProjectsByOrganization = typeof listProjectsByOrganization;
type ListVisibleProjectSummaries = typeof listVisibleProjectSummaries;
type ResolveRequiredOrganization = typeof resolveRequiredOrganization;

interface ProjectListServiceMocks {
  buildProjectOverviewSummaries: Mock<BuildProjectOverviewSummaries>;
  buildProjectStatusSummaries: Mock<BuildProjectStatusSummaries>;
  getApiConfig: Mock<GetApiConfig>;
  listOverviewProjectRowsPageByOrganization: Mock<ListOverviewProjectRowsPageByOrganization>;
  listProjectsByIds: Mock<ListProjectsByIds>;
  listProjectsByOrganization: Mock<ListProjectsByOrganization>;
  listVisibleProjectSummaries: Mock<ListVisibleProjectSummaries>;
  resolveRequiredOrganization: Mock<ResolveRequiredOrganization>;
}

const mocks: ProjectListServiceMocks = vi.hoisted(
  (): ProjectListServiceMocks => ({
    buildProjectOverviewSummaries: vi.fn<BuildProjectOverviewSummaries>(),
    buildProjectStatusSummaries: vi.fn<BuildProjectStatusSummaries>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    listOverviewProjectRowsPageByOrganization: vi.fn<ListOverviewProjectRowsPageByOrganization>(),
    listProjectsByIds: vi.fn<ListProjectsByIds>(),
    listProjectsByOrganization: vi.fn<ListProjectsByOrganization>(),
    listVisibleProjectSummaries: vi.fn<ListVisibleProjectSummaries>(),
    resolveRequiredOrganization: vi.fn<ResolveRequiredOrganization>(),
  }),
);

vi.mock(
  '../src/queries/project-list.query',
  (): { listOverviewProjectRowsPageByOrganization: Mock<ListOverviewProjectRowsPageByOrganization> } => ({
    listOverviewProjectRowsPageByOrganization: mocks.listOverviewProjectRowsPageByOrganization,
  }),
);

vi.mock(
  '../src/queries/projects.query',
  (): {
    listProjectsByIds: Mock<ListProjectsByIds>;
    listProjectsByOrganization: Mock<ListProjectsByOrganization>;
  } => ({
    listProjectsByIds: mocks.listProjectsByIds,
    listProjectsByOrganization: mocks.listProjectsByOrganization,
  }),
);

vi.mock(
  '../src/services/project-visibility.service',
  (): { listVisibleProjectSummaries: Mock<ListVisibleProjectSummaries> } => ({
    listVisibleProjectSummaries: mocks.listVisibleProjectSummaries,
  }),
);

vi.mock(
  '../src/services/project-list-overview.service',
  (): {
    buildProjectOverviewSummaries: Mock<BuildProjectOverviewSummaries>;
  } => ({
    buildProjectOverviewSummaries: mocks.buildProjectOverviewSummaries,
  }),
);

vi.mock(
  '../src/services/project-list-status.service',
  (): {
    buildProjectStatusSummaries: Mock<BuildProjectStatusSummaries>;
  } => ({
    buildProjectStatusSummaries: mocks.buildProjectStatusSummaries,
  }),
);

vi.mock(
  '../src/services/project-scope.service',
  (): { resolveRequiredOrganization: Mock<ResolveRequiredOrganization> } => ({
    resolveRequiredOrganization: mocks.resolveRequiredOrganization,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

describe('project list service', (): void => {
  afterEach((): void => {
    mocks.buildProjectOverviewSummaries.mockReset();
    mocks.buildProjectStatusSummaries.mockReset();
    mocks.getApiConfig.mockReset();
    mocks.listOverviewProjectRowsPageByOrganization.mockReset();
    mocks.listProjectsByIds.mockReset();
    mocks.listProjectsByOrganization.mockReset();
    mocks.listVisibleProjectSummaries.mockReset();
    mocks.resolveRequiredOrganization.mockReset();
  });

  it('keeps summary rows summary-shaped when ordered by overview fields', async (): Promise<void> => {
    mocks.resolveRequiredOrganization.mockResolvedValueOnce(createOrganization());
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    const billing: ProjectRow = createProjectRow('billing');
    mocks.listProjectsByOrganization.mockResolvedValueOnce([billing]);
    mocks.listVisibleProjectSummaries.mockResolvedValueOnce([createVisibleProjectSummary(billing)]);
    mocks.listOverviewProjectRowsPageByOrganization.mockResolvedValueOnce({
      pagination: {
        page: 1,
        perPage: 1,
        totalItems: 2,
        totalPages: 2,
      },
      projects: [billing],
    });

    const result: ProjectListResult = await listProjectListForPrincipal({
      archiveState: 'active',
      detail: 'summary',
      orderBy: 'serviceCount',
      organizationSlug: 'acme-dev',
      page: 1,
      perPage: 1,
      principalId: 'prn_123',
      search: 'billing',
      sort: 'desc',
    });

    if (result.detail !== 'summary') {
      throw new Error('Expected summary result.');
    }
    expect(result.pagination).toEqual({
      page: 1,
      perPage: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(result.detail).toBe('summary');
    expect(result.projects).toEqual([buildProjectSummaryListItem(billing)]);
    expect(mocks.listOverviewProjectRowsPageByOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveState: 'active',
        orderBy: 'serviceCount',
        organizationId: 'org_123',
        page: 1,
        perPage: 1,
        search: 'billing',
        sort: 'desc',
      }),
    );
    expect(mocks.buildProjectOverviewSummaries).not.toHaveBeenCalled();
    expect(mocks.listProjectsByOrganization).toHaveBeenCalledWith('org_123', false);
  });

  it('filters archived projects before building summary rows', async (): Promise<void> => {
    mocks.resolveRequiredOrganization.mockResolvedValueOnce(createOrganization());
    const active: ProjectRow = createProjectRow('current-web');
    const archived: ProjectRow = createProjectRow('old-web', new Date('2026-04-26T10:00:00.000Z'));
    mocks.listProjectsByOrganization.mockResolvedValueOnce([active, archived]);
    mocks.listVisibleProjectSummaries.mockResolvedValueOnce([
      createVisibleProjectSummary(active),
      createVisibleProjectSummary(archived),
    ]);

    const result: ProjectListResult = await listProjectListForPrincipal({
      archiveState: 'archived',
      detail: 'summary',
      orderBy: 'updatedAt',
      organizationSlug: 'acme-dev',
      page: 1,
      perPage: 10,
      principalId: 'prn_123',
      search: 'old',
      sort: 'asc',
    });

    if (result.detail !== 'summary') {
      throw new Error('Expected summary result.');
    }
    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(result.detail).toBe('summary');
    expect(result.projects.map((project: ProjectSummaryListItem): string => project.name)).toEqual(['old-web']);
    expect(mocks.listProjectsByOrganization).toHaveBeenCalledWith('org_123', true);
    expect(mocks.buildProjectOverviewSummaries).not.toHaveBeenCalled();
  });
});

function createApiConfig(): ApiConfig {
  return {
    baseDomain: 'example.test',
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  } as ApiConfig;
}

function createOrganization(): OrganizationRow {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

function createProjectRow(name: string, archivedAt: Date | null = null): ProjectRow {
  return {
    archivedAt,
    createdAt: new Date('2026-04-25T10:00:00.000Z'),
    id: `prj_${name.replace('-', '_')}`,
    name,
    organizationId: 'org_123',
    updatedAt: new Date('2026-04-26T10:00:00.000Z'),
  };
}

function createVisibleProjectSummary(project: ProjectRow): VisibleProjectSummary {
  return {
    hasEnvironmentVisibility: false,
    permissions: ['project.read'],
    project,
  };
}
