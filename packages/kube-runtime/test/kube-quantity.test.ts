import { describe, expect, it } from 'vitest';
import { addKubernetesQuantities } from '../src/kube-quantity';

describe('Kubernetes quantity addition', (): void => {
  it('adds decimal and binary quantities without floating-point conversion', (): void => {
    expect(addKubernetesQuantities('2', '50m')).toBe('2050m');
    expect(addKubernetesQuantities('1Gi', '512Mi')).toBe('1536Mi');
    expect(addKubernetesQuantities('16Gi', '2Gi')).toBe('18Gi');
  });

  it('rejects values outside the validated Kubernetes quantity contract', (): void => {
    expect((): string => addKubernetesQuantities('invalid', '1')).toThrow('Invalid Kubernetes quantity: invalid.');
    expect((): string => addKubernetesQuantities('1e999999999', '1Gi')).toThrow(
      'Invalid Kubernetes quantity: 1e999999999.',
    );
    expect((): string => addKubernetesQuantities('8Ei', '1')).toThrow('Invalid Kubernetes quantity: 8Ei.');
  });
});
