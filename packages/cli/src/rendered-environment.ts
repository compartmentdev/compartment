import { hasText } from '@compartment/utils';
import type { RenderedSelfHostedEnvironment } from './self-hosted-env.types';

export function readRequiredRenderedEnvironmentValue(
  renderedEnvironment: RenderedSelfHostedEnvironment,
  variableName: string,
): string {
  const variableValue: string | undefined = renderedEnvironment.values[variableName];
  if (hasText(variableValue)) {
    return variableValue;
  }

  throw new Error(
    `The rendered self-hosted environment is missing ${variableName}. Ensure the bundled env template declares it.`,
  );
}
