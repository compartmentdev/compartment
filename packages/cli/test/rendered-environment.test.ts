import { describe, expect, it } from 'vitest';
import { readRequiredRenderedEnvironmentValue } from '../src/rendered-environment';
import type { RenderedSelfHostedEnvironment } from '../src/self-hosted-env.types';

describe('rendered environment helpers', (): void => {
  it('reads declared env values without fallback defaults', (): void => {
    const renderedEnvironment: RenderedSelfHostedEnvironment = {
      text: 'COMPARTMENT_API_URL=http://127.0.0.1:39444',
      values: {
        COMPARTMENT_API_URL: 'http://127.0.0.1:39444',
      },
    };

    expect(readRequiredRenderedEnvironmentValue(renderedEnvironment, 'COMPARTMENT_API_URL')).toBe(
      'http://127.0.0.1:39444',
    );
  });

  it('fails fast when a required env value is missing', (): void => {
    const renderedEnvironment: RenderedSelfHostedEnvironment = {
      text: '',
      values: {},
    };

    expect((): string => readRequiredRenderedEnvironmentValue(renderedEnvironment, 'COMPARTMENT_API_URL')).toThrowError(
      'The rendered self-hosted environment is missing COMPARTMENT_API_URL. Ensure the bundled env template declares it.',
    );
  });
});
