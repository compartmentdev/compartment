export interface SerializedLimitRangeItem {
  default: Record<string, string>;
  defaultRequest: Record<string, string>;
}

export interface SerializedLimitRangeSpec {
  limits: SerializedLimitRangeItem[];
}

export interface SerializedLimitRange {
  spec: SerializedLimitRangeSpec;
}
