import type { OrganizationQuotaCapacity, ProjectContainerDefaults, ProjectQuota } from '@compartment/kube-runtime';
import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';
import type { NormalizedKubernetesQuantity } from './resource-quota-config.types';

const kubernetesQuantityPattern: RegExp =
  /^\+?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[numkMGTPE]|[KMGTPE]i|[eE][+-]?[0-9]+)?$/u;
const kubernetesQuantityCapturePattern: RegExp =
  /^\+?([0-9]+(?:\.[0-9]*)?|\.[0-9]+)([numkMGTPE]|[KMGTPE]i|[eE][+-]?[0-9]+)?$/u;
const kubernetesQuantitySchema: z.ZodString = z
  .string()
  .regex(kubernetesQuantityPattern, 'must be a valid non-negative Kubernetes quantity');
const computeResourcesSchema = z.object({ cpu: kubernetesQuantitySchema, memory: kubernetesQuantitySchema }).strict();
const projectContainerDefaultsSchema: z.ZodType<ProjectContainerDefaults> = z
  .object({ limit: computeResourcesSchema, request: computeResourcesSchema })
  .strict()
  .superRefine((defaults: ProjectContainerDefaults, context: z.RefinementCtx): void => {
    if (compareKubernetesQuantities(defaults.request.cpu, defaults.limit.cpu) === 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not exceed limit.cpu', path: ['request', 'cpu'] });
    }
    if (compareKubernetesQuantities(defaults.request.memory, defaults.limit.memory) === 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not exceed limit.memory',
        path: ['request', 'memory'],
      });
    }
  });
const quotaSchema: z.ZodType<ProjectQuota> = z
  .object({
    limitsCpu: kubernetesQuantitySchema,
    limitsMemory: kubernetesQuantitySchema,
    requestsCpu: kubernetesQuantitySchema,
    requestsMemory: kubernetesQuantitySchema,
    requestsStorage: kubernetesQuantitySchema,
  })
  .strict()
  .superRefine((quota: ProjectQuota, context: z.RefinementCtx): void => {
    if (compareKubernetesQuantities(quota.requestsCpu, quota.limitsCpu) === 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not exceed limitsCpu', path: ['requestsCpu'] });
    }
    if (compareKubernetesQuantities(quota.requestsMemory, quota.limitsMemory) === 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not exceed limitsMemory',
        path: ['requestsMemory'],
      });
    }
  });

export function readProjectContainerDefaults(value: string, name: string): ProjectContainerDefaults {
  return readResourceConfiguration(value, name, projectContainerDefaultsSchema);
}

export function readProjectQuota(value: string, name: string): ProjectQuota {
  return readResourceConfiguration(value, name, quotaSchema);
}

export function readOrganizationQuota(value: string, name: string): OrganizationQuotaCapacity {
  return readResourceConfiguration(value, name, quotaSchema);
}

function readResourceConfiguration<T>(value: string, name: string, schema: z.ZodType<T>): T {
  let input: JsonValue;
  try {
    input = JSON.parse(value) as JsonValue;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  const parsed: z.SafeParseReturnType<JsonValue, T> = schema.safeParse(input);
  if (!parsed.success) {
    const issue: z.ZodIssue | undefined = parsed.error.issues[0];
    const path: string = issue?.path.join('.') ?? 'value';
    const message: string = issue?.message ?? 'is invalid';
    throw new Error(`${name} ${path} ${message}.`);
  }
  return parsed.data;
}

function compareKubernetesQuantities(left: string, right: string): -1 | 0 | 1 | null {
  const leftQuantity: NormalizedKubernetesQuantity | null = normalizeKubernetesQuantity(left);
  const rightQuantity: NormalizedKubernetesQuantity | null = normalizeKubernetesQuantity(right);
  if (leftQuantity === null || rightQuantity === null) {
    return null;
  }
  return compareNormalizedKubernetesQuantities(leftQuantity, rightQuantity);
}

function compareNormalizedKubernetesQuantities(
  leftQuantity: NormalizedKubernetesQuantity,
  rightQuantity: NormalizedKubernetesQuantity,
): -1 | 0 | 1 {
  const [leftDigits, leftExponent]: NormalizedKubernetesQuantity = leftQuantity;
  const [rightDigits, rightExponent]: NormalizedKubernetesQuantity = rightQuantity;
  const zeroComparison: -1 | 0 | 1 | null = compareZeroQuantities(leftDigits, rightDigits);
  if (zeroComparison !== null) {
    return zeroComparison;
  }
  const leftMagnitude: bigint = BigInt(leftDigits.length) + leftExponent;
  const rightMagnitude: bigint = BigInt(rightDigits.length) + rightExponent;
  if (leftMagnitude !== rightMagnitude) {
    return leftMagnitude < rightMagnitude ? -1 : 1;
  }
  return compareAlignedQuantityDigits(leftDigits, rightDigits);
}

function normalizeKubernetesQuantity(value: string): NormalizedKubernetesQuantity | null {
  const match: RegExpExecArray | null = kubernetesQuantityCapturePattern.exec(value);
  if (match === null) {
    return null;
  }
  const number: string = match[1]!;
  const suffix: string = match[2] ?? '';
  const fractionLength: number = number.split('.')[1]?.length ?? 0;
  const coefficient: bigint = BigInt(number.replace('.', '')) * suffixBinaryMultiplier(suffix);
  const decimalExponent: bigint = -BigInt(fractionLength) + suffixDecimalExponent(suffix);
  if (coefficient === 0n) {
    return ['0', 0n];
  }
  return trimQuantityCoefficient(coefficient, decimalExponent);
}

function trimQuantityCoefficient(coefficient: bigint, decimalExponent: bigint): NormalizedKubernetesQuantity {
  let digits: string = coefficient.toString();
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    decimalExponent += 1n;
  }
  return [digits, decimalExponent];
}

function compareZeroQuantities(left: string, right: string): -1 | 0 | 1 | null {
  if (left !== '0' && right !== '0') {
    return null;
  }
  if (left === right) {
    return 0;
  }
  return left === '0' ? -1 : 1;
}

function compareAlignedQuantityDigits(left: string, right: string): -1 | 0 | 1 {
  const width: number = Math.max(left.length, right.length);
  left = left.padEnd(width, '0');
  right = right.padEnd(width, '0');
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function suffixDecimalExponent(suffix: string): bigint {
  if (suffix.startsWith('e') || (suffix.startsWith('E') && suffix.length > 1)) {
    return BigInt(suffix.slice(1));
  }
  switch (suffix) {
    case 'n':
      return -9n;
    case 'u':
      return -6n;
    case 'm':
      return -3n;
    case 'k':
      return 3n;
    case 'M':
      return 6n;
    case 'G':
      return 9n;
    case 'T':
      return 12n;
    case 'P':
      return 15n;
    case 'E':
      return 18n;
    default:
      return 0n;
  }
}

function suffixBinaryMultiplier(suffix: string): bigint {
  switch (suffix) {
    case 'Ki':
      return 1n << 10n;
    case 'Mi':
      return 1n << 20n;
    case 'Gi':
      return 1n << 30n;
    case 'Ti':
      return 1n << 40n;
    case 'Pi':
      return 1n << 50n;
    case 'Ei':
      return 1n << 60n;
    default:
      return 1n;
  }
}
