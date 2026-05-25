import type { ApiBusinessErrorDefinition } from './api-business-error.types';

type DeploymentApiBusinessErrorCode =
  | 'active_deployment_not_found'
  | 'deployment_image_cleaned'
  | 'deployment_image_not_available'
  | 'deployment_not_found'
  | 'deployment_target_busy'
  | 'rollback_run_topology_mismatch'
  | 'rollback_service_required'
  | 'rollback_target_not_found'
  | 'unsupported_service_kind';

export const deploymentBusinessErrorDefinitions: Record<DeploymentApiBusinessErrorCode, ApiBusinessErrorDefinition> = {
  active_deployment_not_found: {
    message: 'No active deployment was found for this environment and service.',
    statusCode: 404,
  },
  deployment_image_cleaned: {
    message: 'The selected deployment image was cleaned by rollback retention.',
    statusCode: 409,
  },
  deployment_image_not_available: {
    message: 'The selected deployment does not have a reusable image yet.',
    statusCode: 409,
  },
  deployment_not_found: {
    message: 'The requested deployment was not found.',
    statusCode: 404,
  },
  deployment_target_busy: {
    message: 'A deployment movement is already in progress for this environment and service.',
    statusCode: 409,
  },
  rollback_run_topology_mismatch: {
    message: 'The selected deployment run does not cover all currently active services in this environment.',
    statusCode: 409,
  },
  rollback_service_required: {
    message: 'Select a service when rolling back to a specific deployment in a multi-service project.',
    statusCode: 409,
  },
  rollback_target_not_found: {
    message: 'No valid rollback target was found.',
    statusCode: 404,
  },
  unsupported_service_kind: {
    message: 'The requested service kind is not supported by the current deployment runtime.',
    statusCode: 400,
  },
};
