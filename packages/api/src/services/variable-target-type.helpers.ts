export type VariableTargetType = 'environment' | 'resource' | 'service';

interface VariableTargetTypeInput {
  resourceName: string | null;
  serviceName: string | null;
}

export function readVariableTargetType(input: VariableTargetTypeInput): VariableTargetType {
  if (input.resourceName !== null) {
    return 'resource';
  }

  return input.serviceName === null ? 'environment' : 'service';
}
