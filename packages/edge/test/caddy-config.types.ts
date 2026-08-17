export interface CaddyAdaptedConfig {
  admin?: CaddyAdminConfig;
  apps: CaddyAppsConfig;
}

export interface CaddyAdminConfig {
  listen?: string;
}

export interface CaddyAppsConfig {
  http: CaddyHttpAppConfig;
}

export interface CaddyHttpAppConfig {
  metrics?: CaddyMetricsConfig;
  servers: Record<string, CaddyServerConfig>;
}

export interface CaddyMetricsConfig {
  per_host?: boolean;
}

export interface CaddyServerConfig {
  automatic_https?: CaddyAutomaticHttpsConfig;
  client_ip_headers?: string[];
  listen: string[];
  routes: CaddyRoute[];
  trusted_proxies?: CaddyTrustedProxiesConfig;
  trusted_proxies_strict?: number;
}

export interface CaddyAutomaticHttpsConfig {
  disable?: boolean;
}

export interface CaddyTrustedProxiesConfig {
  ranges?: string[];
  source: string;
}

export interface CaddyRoute {
  handle?: CaddyHandler[];
  match?: CaddyMatcher[];
}

export interface CaddyMatcher {
  header?: Record<string, string[]>;
  host?: string[];
  path?: string[];
}

export interface CaddyHandler {
  api_url?: string;
  app_burst?: number;
  app_in_flight?: number;
  app_requests_per_second?: number;
  client_burst?: number;
  client_requests_per_second?: number;
  edge_token?: string;
  flush_interval?: number;
  handle_response?: CaddyResponseHandler[];
  handler: string;
  headers?: CaddyHeadersConfig;
  public_scheme?: string;
  /** The `headers` handler carries its operations directly; `reverse_proxy` nests them under `headers`. */
  request?: CaddyHeaderOperations;
  response?: CaddyHeaderOperations;
  rewrite?: CaddyRewriteConfig;
  routes?: CaddyRoute[];
  status_code?: number;
  upstreams?: CaddyUpstream[];
}

export interface CaddyResponseHandler {
  routes?: CaddyRoute[];
}

export interface CaddyHeadersConfig {
  request?: CaddyHeaderOperations;
  response?: CaddyHeaderOperations;
}

export interface CaddyHeaderOperations {
  delete?: string[];
  replace?: Record<string, CaddyHeaderReplacement[]>;
  set?: Record<string, string[]>;
}

export interface CaddyHeaderReplacement {
  replace?: string;
  search_regexp?: string;
}

export interface CaddyRewriteConfig {
  method?: string;
  uri?: string;
}

export interface CaddyUpstream {
  dial: string;
}

/**
 * Handlers are nested arbitrarily deep in subroutes, and the matchers that gate them sit on ancestor
 * routes. Assertions therefore address a handler by the hosts and matchers it inherits and by its
 * position in the request pipeline instead of by array indexes.
 */
export interface CaddyHandlerLocation {
  handler: CaddyHandler;
  hosts: readonly string[];
  matchers: readonly CaddyMatcher[];
  order: number;
}

export interface CaddyCookieReplacement {
  replace: string;
  searchRegexp: string;
}

export interface CaddyRouteScope {
  hosts: readonly string[];
  matchers: readonly CaddyMatcher[];
}

export interface CaddyCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CaddyValidationSetup {
  helmAvailable: boolean;
  image: string | undefined;
  required: boolean;
}

/** Subset of a rendered chart manifest the validation environment is taken from. */
export interface ChartManifest {
  spec?: ChartWorkloadSpec;
}

export interface ChartWorkloadSpec {
  template?: ChartPodTemplate;
}

export interface ChartPodTemplate {
  spec?: ChartPodSpec;
}

export interface ChartPodSpec {
  containers?: ChartContainer[];
}

export interface ChartContainer {
  env?: ChartContainerEnvEntry[];
  name: string;
}

export interface ChartContainerEnvEntry {
  name: string;
  value?: string;
  valueFrom?: ChartEnvVarSource;
}

/** Only a literal value and a secret reference can be substituted; the rest have to fail loudly. */
export interface ChartEnvVarSource {
  configMapKeyRef?: ChartKeyReference;
  fieldRef?: ChartObjectFieldReference;
  resourceFieldRef?: ChartResourceFieldReference;
  secretKeyRef?: ChartKeyReference;
}

export interface ChartKeyReference {
  key: string;
  name: string;
}

export interface ChartObjectFieldReference {
  fieldPath: string;
}

export interface ChartResourceFieldReference {
  resource: string;
}

export interface WorkflowFile {
  jobs: Record<string, WorkflowJob>;
}

export interface WorkflowJob {
  env?: Record<string, string>;
  needs?: string[];
  steps?: WorkflowStep[];
  uses?: string;
}

export interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}
