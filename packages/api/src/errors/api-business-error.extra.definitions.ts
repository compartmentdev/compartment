import type { ApiBusinessErrorDefinition } from './api-business-error.types';

type ExtraApiBusinessErrorCode =
  | 'access_assignment_not_found'
  | 'access_group_name_taken'
  | 'access_group_not_found'
  | 'access_role_immutable'
  | 'access_role_name_taken'
  | 'access_role_not_found'
  | 'audit_export_too_large';

export const extraBusinessErrorDefinitions: Record<ExtraApiBusinessErrorCode, ApiBusinessErrorDefinition> = {
  access_assignment_not_found: {
    message: 'The requested access assignment was not found.',
    statusCode: 404,
  },
  access_group_name_taken: {
    message: 'A group with this name already exists in the selected organization.',
    statusCode: 409,
  },
  access_group_not_found: {
    message: 'The requested access group was not found.',
    statusCode: 404,
  },
  access_role_immutable: {
    message: 'System roles are read-only.',
    statusCode: 409,
  },
  access_role_name_taken: {
    message: 'A role with this name already exists in the selected organization.',
    statusCode: 409,
  },
  access_role_not_found: {
    message: 'The requested access role was not found.',
    statusCode: 404,
  },
  audit_export_too_large: {
    message: 'Audit export is too large. Narrow the time range or filters.',
    statusCode: 413,
  },
};
