export interface KubeLimitRangeResources {
  cpu: string;
  memory: string;
}

export interface ProjectContainerDefaults {
  limit: KubeLimitRangeResources;
  request: KubeLimitRangeResources;
}

export interface KubeLimitRangeItem {
  _default: KubeLimitRangeResources;
  defaultRequest: KubeLimitRangeResources;
  type: 'Container';
}

export interface KubeLimitRangeSpec {
  limits: KubeLimitRangeItem[];
}
