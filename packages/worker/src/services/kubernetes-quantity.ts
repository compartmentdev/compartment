const cpuMillicoreFactors: Readonly<Record<string, number>> = {
  '': 1_000,
  E: 1e21,
  G: 1e12,
  M: 1e9,
  P: 1e18,
  T: 1e15,
  k: 1e6,
  m: 1,
  n: 0.000_001,
  u: 0.001,
};
const memoryByteFactors: Readonly<Record<string, number>> = {
  '': 1,
  E: 1e18,
  Ei: 2 ** 60,
  G: 1e9,
  Gi: 2 ** 30,
  k: 1e3,
  Ki: 2 ** 10,
  M: 1e6,
  Mi: 2 ** 20,
  m: 0.001,
  P: 1e15,
  Pi: 2 ** 50,
  T: 1e12,
  Ti: 2 ** 40,
};

export function parseKubernetesQuantity(value: string, kind: 'cpu' | 'memory'): number {
  const match: RegExpExecArray | null =
    /^(?<amount>[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)(?<suffix>[a-zA-Z]*)$/u.exec(value);
  if (match?.groups === undefined) {
    throw new Error(`Invalid Kubernetes ${kind} quantity: ${value}.`);
  }
  const amount: number = Number(match.groups.amount);
  const suffix: string = match.groups.suffix ?? '';
  const factor: number | undefined = kind === 'cpu' ? cpuMillicoreFactors[suffix] : memoryByteFactors[suffix];
  if (factor === undefined) {
    throw new Error(`Unsupported Kubernetes ${kind} quantity suffix: ${suffix}.`);
  }
  return amount * factor;
}
