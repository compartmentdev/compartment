import { describe, expect, it } from 'vitest';
import type { DeploymentStatusResponse } from '@compartment/contracts';
import { buildVerboseDeploymentDetails } from '../src/commands/deployments/deployment.command.details';
import { createActiveDeploymentStatusResponseFixture } from './cli-test.fixtures';

describe('deployment command details', (): void => {
  it('shows failure details when a deployment has an error message', (): void => {
    const response: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture({
      deployment: {
        failureMessage: 'Boot failed.',
      },
      environment: {
        name: 'production',
      },
      project: {
        name: 'smoke-web',
      },
    });
    const message: string = buildVerboseDeploymentDetails({
      displayedDeployments: response.deployments,
      environmentName: 'production',
      projectName: 'smoke-web',
      response,
    });

    expect(message).toContain('Failure: Boot failed.');
  });
});
