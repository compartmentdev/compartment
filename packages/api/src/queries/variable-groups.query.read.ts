import { asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  environments,
  environmentVariableSetBindings,
  organizationVariableSetEntries,
  organizationVariableSets,
  projects,
  projectServices,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  PersistedVariableGroupSummaryRow,
  VariableGroupRow,
  VariableGroupSummaryRow,
  VariableGroupUsageRow,
} from './variable-groups.query.types';
import type { EnvironmentVariableSetBindingRow } from './variables.query.types';
import {
  buildActiveVariableGroupPredicate,
  buildScopedVariableGroupBindingPredicate,
  buildVariableGroupByNamePredicate,
} from './variable-groups.query.helpers';

const variableGroupSummaryCountSql: SQL<number> = sql<number>`cast(count(${organizationVariableSetEntries.id}) as integer)`;
const variableGroupUsageSelection: {
  environmentName: typeof environments.name;
  projectName: typeof projects.name;
  resourceName: typeof environmentVariableSetBindings.targetResourceName;
  serviceName: typeof projectServices.name;
} = {
  environmentName: environments.name,
  projectName: projects.name,
  resourceName: environmentVariableSetBindings.targetResourceName,
  serviceName: projectServices.name,
};

export async function listVariableGroups(organizationId: string): Promise<VariableGroupSummaryRow[]> {
  const rows: PersistedVariableGroupSummaryRow[] = await getApiDatabase()
    .select({
      createdAt: organizationVariableSets.createdAt,
      description: organizationVariableSets.description,
      name: organizationVariableSets.name,
      updatedAt: organizationVariableSets.updatedAt,
      variableCount: variableGroupSummaryCountSql,
    })
    .from(organizationVariableSets)
    .leftJoin(
      organizationVariableSetEntries,
      eq(organizationVariableSetEntries.organizationVariableSetId, organizationVariableSets.id),
    )
    .where(buildActiveVariableGroupPredicate(organizationId))
    .groupBy(
      organizationVariableSets.id,
      organizationVariableSets.createdAt,
      organizationVariableSets.description,
      organizationVariableSets.name,
      organizationVariableSets.updatedAt,
    )
    .orderBy(asc(organizationVariableSets.name));

  return rows.map(mapVariableGroupSummaryRow);
}

export async function findVariableGroupByName(
  organizationId: string,
  variableGroupName: string,
): Promise<VariableGroupRow | undefined> {
  const rows: VariableGroupRow[] = await getApiDatabase()
    .select()
    .from(organizationVariableSets)
    .where(buildVariableGroupByNamePredicate(organizationId, variableGroupName))
    .limit(1);

  return rows[0];
}

export async function listVariableGroupUsages(
  organizationId: string,
  variableGroupId: string,
): Promise<VariableGroupUsageRow[]> {
  return await buildVariableGroupUsagesQuery(organizationId, variableGroupId);
}

export async function listVariableGroupBindings(
  organizationId: string,
  variableGroupId: string,
): Promise<EnvironmentVariableSetBindingRow[]> {
  return await getApiDatabase()
    .select({
      createdAt: environmentVariableSetBindings.createdAt,
      createdByPrincipalId: environmentVariableSetBindings.createdByPrincipalId,
      environmentId: environmentVariableSetBindings.environmentId,
      id: environmentVariableSetBindings.id,
      organizationVariableSetId: environmentVariableSetBindings.organizationVariableSetId,
      projectServiceId: environmentVariableSetBindings.projectServiceId,
      targetResourceName: environmentVariableSetBindings.targetResourceName,
    })
    .from(environmentVariableSetBindings)
    .innerJoin(
      organizationVariableSets,
      eq(organizationVariableSets.id, environmentVariableSetBindings.organizationVariableSetId),
    )
    .innerJoin(environments, eq(environments.id, environmentVariableSetBindings.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(buildScopedVariableGroupBindingPredicate(organizationId, variableGroupId))
    .orderBy(asc(environmentVariableSetBindings.environmentId), asc(environmentVariableSetBindings.projectServiceId));
}

async function buildVariableGroupUsagesQuery(
  organizationId: string,
  variableGroupId: string,
): Promise<VariableGroupUsageRow[]> {
  return await getApiDatabase()
    .select(variableGroupUsageSelection)
    .from(environmentVariableSetBindings)
    .innerJoin(environments, eq(environments.id, environmentVariableSetBindings.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(
      organizationVariableSets,
      eq(organizationVariableSets.id, environmentVariableSetBindings.organizationVariableSetId),
    )
    .leftJoin(projectServices, eq(projectServices.id, environmentVariableSetBindings.projectServiceId))
    .where(buildScopedVariableGroupBindingPredicate(organizationId, variableGroupId))
    .orderBy(
      asc(projects.name),
      asc(environments.name),
      asc(projectServices.name),
      asc(environmentVariableSetBindings.targetResourceName),
    );
}

function mapVariableGroupSummaryRow(row: PersistedVariableGroupSummaryRow): VariableGroupSummaryRow {
  return {
    createdAt: row.createdAt,
    description: row.description,
    name: row.name,
    updatedAt: row.updatedAt,
    variableCount: row.variableCount,
  };
}
