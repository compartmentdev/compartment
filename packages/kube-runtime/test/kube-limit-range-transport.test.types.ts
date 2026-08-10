export interface SerializedLimitRangeItem {
  default: Record<string, string>;
  defaultRequest: Record<string, string>;
  _default?: Record<string, string> | undefined;
}

export interface SerializedLimitRangeSpec {
  limits: SerializedLimitRangeItem[];
}

export interface SerializedLimitRange {
  spec: SerializedLimitRangeSpec;
}
