export interface KubeLimitRangeResources {
  cpu: string;
  memory: string;
}

export interface KubeLimitRangeItem {
  default: KubeLimitRangeResources;
  defaultRequest: KubeLimitRangeResources;
  type: 'Container';
}

export interface KubeLimitRangeSpec {
  limits: KubeLimitRangeItem[];
}
