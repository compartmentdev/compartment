import type { ApiBusinessErrorDefinition } from './api-business-error.types';

type ResourceApiBusinessErrorCode =
  | 'resource_backup_not_found'
  | 'resource_conflict'
  | 'resource_name_taken'
  | 'resource_not_found';

export const resourceBusinessErrorDefinitions: Record<ResourceApiBusinessErrorCode, ApiBusinessErrorDefinition> = {
  resource_backup_not_found: {
    message: 'The requested resource backup was not found.',
    statusCode: 404,
  },
  resource_conflict: {
    message: 'The resource conflicts with its current state.',
    statusCode: 409,
  },
  resource_name_taken: {
    message: 'A resource with this name already exists in the selected environment.',
    statusCode: 409,
  },
  resource_not_found: {
    message: 'The requested resource was not found.',
    statusCode: 404,
  },
};
