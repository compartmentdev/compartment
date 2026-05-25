interface VariableGroupKeyNameSource {
  keyName: string;
}

export function readVariableGroupKeyNames(sources: readonly VariableGroupKeyNameSource[]): string[] {
  return sources.map((source: VariableGroupKeyNameSource): string => source.keyName);
}
