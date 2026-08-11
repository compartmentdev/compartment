import type { JsonValue } from '@compartment/utils';
import type {
  KubernetesImageTrustJsonObject,
  KubernetesImageValueFields,
} from './kubernetes-image-trust.service.types';

export function readImageTrustObject(value: JsonValue | undefined, label: string): KubernetesImageTrustJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
}

export function readOptionalImageStringField(
  value: KubernetesImageTrustJsonObject,
  field: keyof KubernetesImageValueFields,
): KubernetesImageValueFields {
  if (!Object.hasOwn(value, field)) {
    return {};
  }
  const fieldValue: JsonValue | undefined = value[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`Expected Helm image ${field} to be a string.`);
  }
  return { [field]: fieldValue };
}
