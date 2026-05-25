export interface AddCustomDomainCommandInput {
  cwd: string;
  environmentName?: string | undefined;
  host: string;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface ListCustomDomainsCommandInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface CustomDomainHostCommandInput {
  host: string;
}
