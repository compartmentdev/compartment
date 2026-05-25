import type { PgExtraConfigColumnsOf, PgTableOf } from './schema.shared.types';
import type {
  EnvironmentsColumnBuilders,
  ProjectServicesColumnBuilders,
  ProjectsColumnBuilders,
} from './schema-core.types';

export type ProjectsTable = PgTableOf<'projects', ProjectsColumnBuilders>;
export type ProjectsExtraConfigColumns = PgExtraConfigColumnsOf<'projects', ProjectsColumnBuilders>;
export type ProjectServicesTable = PgTableOf<'project_services', ProjectServicesColumnBuilders>;
export type ProjectServicesExtraConfigColumns = PgExtraConfigColumnsOf<
  'project_services',
  ProjectServicesColumnBuilders
>;
export type EnvironmentsTable = PgTableOf<'environments', EnvironmentsColumnBuilders>;
export type EnvironmentsExtraConfigColumns = PgExtraConfigColumnsOf<'environments', EnvironmentsColumnBuilders>;
