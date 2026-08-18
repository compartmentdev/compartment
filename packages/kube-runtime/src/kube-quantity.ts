interface ParsedKubernetesQuantity {
  coefficient: bigint;
  decimalExponent: bigint;
  usesBinarySuffix: boolean;
}

interface KubernetesQuantityUnit {
  binaryMultiplier: bigint;
  decimalExponent: bigint;
  suffix: string;
}

const quantityPattern: RegExp = /^\+?([0-9]+(?:\.[0-9]*)?|\.[0-9]+)([numkMGTPE]|[KMGTPE]i|[eE][+-]?[0-9]+)?$/u;
const maximumQuantity: bigint = 9_223_372_036_854_775_807n;
const minimumQuantityExponent: bigint = -18n;
const maximumQuantityExponent: bigint = 18n;
const binaryUnits: readonly KubernetesQuantityUnit[] = [
  binaryUnit('Ei', 60n),
  binaryUnit('Pi', 50n),
  binaryUnit('Ti', 40n),
  binaryUnit('Gi', 30n),
  binaryUnit('Mi', 20n),
  binaryUnit('Ki', 10n),
];
const decimalUnits: readonly KubernetesQuantityUnit[] = [
  decimalUnit('E', 18n),
  decimalUnit('P', 15n),
  decimalUnit('T', 12n),
  decimalUnit('G', 9n),
  decimalUnit('M', 6n),
  decimalUnit('k', 3n),
  decimalUnit('', 0n),
  decimalUnit('m', -3n),
  decimalUnit('u', -6n),
  decimalUnit('n', -9n),
];

export function addKubernetesQuantities(left: string, right: string): string {
  const leftQuantity: ParsedKubernetesQuantity = parseKubernetesQuantity(left);
  const rightQuantity: ParsedKubernetesQuantity = parseKubernetesQuantity(right);
  const commonExponent: bigint =
    leftQuantity.decimalExponent < rightQuantity.decimalExponent
      ? leftQuantity.decimalExponent
      : rightQuantity.decimalExponent;
  const coefficient: bigint =
    scaleCoefficient(leftQuantity, commonExponent) + scaleCoefficient(rightQuantity, commonExponent);
  assertQuantityRange(coefficient, commonExponent, `${left} + ${right}`);
  if (coefficient === 0n) {
    return '0';
  }
  return formatKubernetesQuantity(
    coefficient,
    commonExponent,
    leftQuantity.usesBinarySuffix && rightQuantity.usesBinarySuffix,
  );
}

function parseKubernetesQuantity(value: string): ParsedKubernetesQuantity {
  const match: RegExpExecArray | null = quantityPattern.exec(value);
  if (match === null) {
    throw new Error(`Invalid Kubernetes quantity: ${value}.`);
  }
  const number: string = match[1]!;
  const suffix: string = match[2] ?? '';
  const fractionLength: bigint = BigInt(number.split('.')[1]?.length ?? 0);
  const quantity: ParsedKubernetesQuantity = {
    coefficient: BigInt(number.replace('.', '')) * binaryMultiplier(suffix),
    decimalExponent: suffixDecimalExponent(suffix) - fractionLength,
    usesBinarySuffix: suffix.endsWith('i'),
  };
  assertQuantityRange(quantity.coefficient, quantity.decimalExponent, value);
  return quantity;
}

function assertQuantityRange(coefficient: bigint, decimalExponent: bigint, value: string): void {
  if (decimalExponent < minimumQuantityExponent || decimalExponent > maximumQuantityExponent) {
    throw new Error(`Invalid Kubernetes quantity: ${value}.`);
  }
  const withinMaximum: boolean =
    decimalExponent >= 0n
      ? coefficient <= maximumQuantity / 10n ** decimalExponent
      : coefficient <= maximumQuantity * 10n ** -decimalExponent;
  if (!withinMaximum) {
    throw new Error(`Invalid Kubernetes quantity: ${value}.`);
  }
}

function scaleCoefficient(quantity: ParsedKubernetesQuantity, exponent: bigint): bigint {
  return quantity.coefficient * 10n ** (quantity.decimalExponent - exponent);
}

function formatKubernetesQuantity(coefficient: bigint, decimalExponent: bigint, preferBinary: boolean): string {
  for (const unit of preferBinary ? binaryUnits : decimalUnits) {
    const exponentDifference: bigint = decimalExponent - unit.decimalExponent;
    const numerator: bigint = exponentDifference < 0n ? coefficient : coefficient * 10n ** exponentDifference;
    const denominator: bigint = unit.binaryMultiplier * (exponentDifference < 0n ? 10n ** -exponentDifference : 1n);
    if (numerator >= denominator && numerator % denominator === 0n) {
      return `${String(numerator / denominator)}${unit.suffix}`;
    }
  }
  return `${String(coefficient)}e${String(decimalExponent)}`;
}

function suffixDecimalExponent(suffix: string): bigint {
  if (/^[eE][+-]?[0-9]/u.test(suffix)) {
    return BigInt(suffix.slice(1));
  }
  return decimalUnits.find((unit: KubernetesQuantityUnit): boolean => unit.suffix === suffix)?.decimalExponent ?? 0n;
}

function binaryMultiplier(suffix: string): bigint {
  return binaryUnits.find((unit: KubernetesQuantityUnit): boolean => unit.suffix === suffix)?.binaryMultiplier ?? 1n;
}

function binaryUnit(suffix: string, shift: bigint): KubernetesQuantityUnit {
  return { binaryMultiplier: 1n << shift, decimalExponent: 0n, suffix };
}

function decimalUnit(suffix: string, decimalExponent: bigint): KubernetesQuantityUnit {
  return { binaryMultiplier: 1n, decimalExponent, suffix };
}
