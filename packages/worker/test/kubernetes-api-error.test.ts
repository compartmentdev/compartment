import { describe, expect, it } from 'vitest';
import { readKubernetesStatusMessage } from '../src/kubernetes-api-error';

describe('Kubernetes API errors', (): void => {
  it('reads generated-client status bodies returned as JSON text', (): void => {
    const body: string = JSON.stringify({
      message: 'ValidatingAdmissionPolicy denied request: Project bootstrap authority is restricted.',
    });

    expect(readKubernetesStatusMessage(body)).toContain('Project bootstrap authority is restricted');
  });

  it('reads status bodies returned as objects', (): void => {
    expect(readKubernetesStatusMessage({ message: 'forbidden' })).toBe('forbidden');
  });
});
