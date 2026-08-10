/**
 * The rendered chart as this extractor reads it. Every field is optional because the input is `helm template`
 * output rather than a contract: a workload that stops carrying one of them is a chart regression the
 * extractor must report by name, not a parse crash.
 */
export interface ChartWorkload {
  kind?: string;
  metadata?: ChartWorkloadMetadata;
  spec?: ChartWorkloadSpec;
}

export interface ChartWorkloadMetadata {
  name?: string;
}

export interface ChartWorkloadSpec {
  template?: ChartPodTemplate;
}

export interface ChartPodTemplate {
  metadata?: ChartPodTemplateMetadata;
  spec?: ChartPodSpec;
}

export interface ChartPodTemplateMetadata {
  labels?: Record<string, string>;
}

export interface ChartPodSpec {
  containers?: ChartContainer[];
}

export interface ChartContainer {
  env?: ChartContainerEnvironmentEntry[];
}

export interface ChartContainerEnvironmentEntry {
  name: string;
  value?: string;
}
