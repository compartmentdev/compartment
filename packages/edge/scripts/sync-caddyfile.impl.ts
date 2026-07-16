import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compartmentAppCallbackPathname,
  compartmentAppLogoutPathname,
  compartmentIngressAuthorizePathname,
  compartmentIngressAuthorizeResponseHeaderNames,
  compartmentOnDemandTlsAskPathname,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import { readCaddyPlatformAppCookieStripDirectives } from '../src/services/edge-caddy-cookie-strip.service';
import {
  edgePublicControlPlaneExactPathnames,
  edgePublicControlPlaneNestedPrefixPathnames,
  edgePublicControlPlanePrefixPathnames,
} from '../src/edge-public-control-plane-paths';

const caddyfilePath: string = resolve(__dirname, '../Caddyfile');
const internalCaddyfilePath: string = resolve(__dirname, '../Caddyfile.internal');
const managedCaddyfilePath: string = resolve(__dirname, '../Caddyfile.managed');
const customCertCaddyfilePath: string = resolve(__dirname, '../Caddyfile.custom-cert');
const customHttpCaddyfilePath: string = resolve(__dirname, '../Caddyfile.custom-http');

if (process.argv.includes('--stdout')) {
  process.stdout.write(renderCaddyfile(readCaddyfileModeArgument()));
} else {
  const internalCaddyfile: string = renderCaddyfile('internal');
  writeFileSync(caddyfilePath, internalCaddyfile);
  writeFileSync(customCertCaddyfilePath, renderCaddyfile('custom-cert'));
  writeFileSync(customHttpCaddyfilePath, renderCaddyfile('custom-http'));
  writeFileSync(internalCaddyfilePath, internalCaddyfile);
  writeFileSync(managedCaddyfilePath, renderCaddyfile('managed'));
}

type CaddyfileMode = 'custom-cert' | 'custom-http' | 'internal' | 'managed';

function renderCaddyfile(mode: CaddyfileMode): string {
  switch (mode) {
    case 'custom-cert':
      return renderCustomCertCaddyfile();
    case 'custom-http':
      return renderCustomHttpCaddyfile();
    case 'internal':
      return renderInternalCaddyfile();
    case 'managed':
      return renderManagedCaddyfile();
  }
}

function renderInternalCaddyfile(): string {
  // Keep the generated Caddyfile readable as Caddyfile text, not line-by-line string assembly.
  return trimLeadingNewline(`
${renderGlobalOptions(false)}

${renderCompartmentSiteBlock('http', false)}

${renderCompartmentSiteBlock('https', true)}

${renderHostedAppSiteBlock('http', false)}

${renderHostedAppSiteBlock('https', true)}
`);
}

function renderManagedCaddyfile(): string {
  return trimLeadingNewline(`
${renderGlobalOptions(true)}

http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {
	@compartment_host host ${renderCompartmentHostMatcher()}
	handle @compartment_host {
${indentBlock(renderCompartmentRouteBlock('redirect'), '\t')}
	}

	handle {
		redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent
	}
}

https://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTPS_PORT} {
	tls {
		issuer {$COMPARTMENT_ACME_ISSUER} {$COMPARTMENT_ACME_CA_URL} {
			email {$COMPARTMENT_ACME_EMAIL}
			dns compartment_broker {
				broker_url {$COMPARTMENT_MANAGED_DOMAIN_BROKER_URL}
				token {$COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN}
			}
			propagation_timeout 5m
			resolvers 1.1.1.1 8.8.8.8
		}
	}

	@compartment_host host ${renderCompartmentHostMatcher()}
	handle @compartment_host {
${indentBlock(renderCompartmentRouteBlock('proxy'), '\t')}
	}

	handle {
${indentBlock(renderHostedAppRouteBlock(), '\t')}
	}
}

${renderOnDemandTlsAppSiteBlock()}
`);
}

function renderCustomCertCaddyfile(): string {
  return trimLeadingNewline(`
${renderGlobalOptions(true)}

http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {
	@compartment_host host ${renderCompartmentHostMatcher()}
	handle @compartment_host {
		redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent
	}

	handle {
		redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent
	}
}

https://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTPS_PORT} {
${renderCustomCertificateTlsLine()}
	@compartment_host host ${renderCompartmentHostMatcher()}
	handle @compartment_host {
${indentBlock(renderCompartmentRouteBlock('proxy'), '\t')}
	}

	handle {
${indentBlock(renderHostedAppRouteBlock(), '\t')}
	}
}

${renderOnDemandTlsAppSiteBlock()}
`);
}

function renderCustomHttpCaddyfile(): string {
  return trimLeadingNewline(`
${renderGlobalOptions(false)}

http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {
	@compartment_host host ${renderCompartmentHostMatcher()}
	handle @compartment_host {
${indentBlock(renderCompartmentRouteBlock('proxy'), '\t')}
	}

	handle {
${indentBlock(renderHostedAppRouteBlock(), '\t')}
	}
}
`);
}

function renderCustomCertificateTlsLine(): string {
  return '\ttls {$COMPARTMENT_CUSTOM_TLS_CERT_FILE} {$COMPARTMENT_CUSTOM_TLS_KEY_FILE}\n';
}

function renderGlobalOptions(includeOnDemandTls: boolean): string {
  return trimTemplateBlock(`
{
	admin {$COMPARTMENT_CADDY_ADMIN_ADDR:localhost:2019}
	auto_https disable_redirects
	skip_install_trust
	http_port {$COMPARTMENT_CADDY_HTTP_PORT}
	https_port {$COMPARTMENT_CADDY_HTTPS_PORT}
${renderOnDemandTlsGlobalOption(includeOnDemandTls)}
}
`);
}

function renderOnDemandTlsGlobalOption(includeOnDemandTls: boolean): string {
  if (!includeOnDemandTls) {
    return '';
  }

  return `\ton_demand_tls {
\t\task http://{$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT}${compartmentOnDemandTlsAskPathname}
\t}`;
}

function renderCompartmentSiteBlock(protocol: 'http' | 'https', includeTls: boolean): string {
  return trimTemplateBlock(`
${renderCompartmentSiteAddress(protocol)} {
${renderTlsLine(includeTls)}${renderCompartmentRouteBlock('proxy')}
}
`);
}

function renderCompartmentSiteAddress(protocol: 'http' | 'https'): string {
  return `${protocol}://${renderCompartmentHostMatcher()}:${readCaddyPortVariable(protocol)}`;
}

function renderCompartmentHostMatcher(): string {
  return 'console.{$COMPARTMENT_BASE_DOMAIN}';
}

function renderHostedAppSiteBlock(protocol: 'http' | 'https', includeTls: boolean): string {
  return trimTemplateBlock(`
${renderHostedAppSiteAddresses(protocol)} {
${renderTlsLine(includeTls)}${renderHostedAppRouteBlock()}
}
`);
}

function renderOnDemandTlsAppSiteBlock(): string {
  return trimTemplateBlock(`
http://:{$COMPARTMENT_CADDY_HTTP_PORT} {
\tredir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent
}

https://:{$COMPARTMENT_CADDY_HTTPS_PORT} {
${renderOnDemandTlsBlock()}

${renderHostedAppRouteBlock()}
}
`);
}

function renderOnDemandTlsBlock(): string {
  return trimTemplateBlock(`
\ttls {
\t\tissuer {$COMPARTMENT_ACME_ISSUER} {$COMPARTMENT_ACME_CA_URL} {
\t\t\temail {$COMPARTMENT_ACME_EMAIL}
\t\t}
\t\ton_demand
\t}
`);
}

function renderCompartmentRouteBlock(action: 'proxy' | 'redirect'): string {
  return renderCompartmentPublicRouteBlock(
    action === 'proxy'
      ? `
			reverse_proxy {$COMPARTMENT_API_INTERNAL_HOST}:{$COMPARTMENT_API_PORT}
`
      : `
			redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent
`,
  );
}

function renderCompartmentPublicRouteBlock(publicRouteAction: string): string {
  return trimTemplateBlock(`
	route {
		@compartment_public_paths path ${renderCompartmentPublicPathMatchers()}
		handle @compartment_public_paths {
${trimLeadingNewline(publicRouteAction)}
		}

		handle {
			respond 404
		}
	}
`);
}

function renderHostedAppRouteBlock(): string {
  return trimTemplateBlock(`
	route {
		@compartment_edge_paths path ${compartmentAppCallbackPathname} ${compartmentAppLogoutPathname}
		handle @compartment_edge_paths {
			reverse_proxy {$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT}
		}

		request_header -X-Compartment-*

		forward_auth {$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT} {
			uri ${compartmentIngressAuthorizePathname}
			header_up Host {host}
			copy_headers {
${renderIngressAuthorizeResponseHeaders()}
			}
		}

		@compartment_proxy_path header_regexp compartment_proxy_path ${compartmentProxyPathHeaderName} ^/.*$
		rewrite @compartment_proxy_path {header.${compartmentProxyPathHeaderName}}

		reverse_proxy {header.${compartmentUpstreamHostHeaderName}}:{header.${compartmentUpstreamPortHeaderName}} {
${indentBlock(renderPlatformAppCookieStripDirectives(), '\t\t\t')}
			header_up -${compartmentProxyPathHeaderName}
			header_up -${compartmentUpstreamHostHeaderName}
			header_up -${compartmentUpstreamPortHeaderName}
		}
	}
`);
}

function renderHostedAppSiteAddresses(protocol: 'http' | 'https'): string {
  const caddyPortVariable: string = readCaddyPortVariable(protocol);

  return `${protocol}://*.{$COMPARTMENT_BASE_DOMAIN}:${caddyPortVariable}`;
}

function renderPlatformAppCookieStripDirectives(): string {
  return readCaddyPlatformAppCookieStripDirectives().join('\n');
}

function renderCompartmentPublicPathMatchers(): string {
  return [
    ...edgePublicControlPlaneExactPathnames,
    ...edgePublicControlPlanePrefixPathnames.flatMap((pathname: string): string[] => [pathname, `${pathname}/*`]),
    ...edgePublicControlPlaneNestedPrefixPathnames.map((pathname: string): string => `${pathname}/*`),
  ].join(' ');
}

function readCaddyPortVariable(protocol: 'http' | 'https'): string {
  return protocol === 'http' ? '{$COMPARTMENT_CADDY_HTTP_PORT}' : '{$COMPARTMENT_CADDY_HTTPS_PORT}';
}

function renderTlsLine(includeTls: boolean): string {
  if (!includeTls) {
    return '';
  }

  return '\ttls internal\n';
}

function renderIngressAuthorizeResponseHeaders(): string {
  return compartmentIngressAuthorizeResponseHeaderNames
    .map((headerName: string): string => `\t\t\t\t${headerName}`)
    .join('\n');
}

function trimTemplateBlock(input: string): string {
  const normalizedInput: string = trimLeadingNewline(input);
  return normalizedInput.endsWith('\n') ? normalizedInput.slice(0, -1) : normalizedInput;
}

function trimLeadingNewline(input: string): string {
  return input.startsWith('\n') ? input.slice(1) : input;
}

function indentBlock(input: string, indentation: string): string {
  return input
    .split('\n')
    .map((line: string): string => (line === '' ? '' : `${indentation}${line}`))
    .join('\n');
}

function readCaddyfileModeArgument(): CaddyfileMode {
  const modeIndex: number = process.argv.indexOf('--mode');
  if (modeIndex === -1) {
    return 'internal';
  }

  const mode: string | undefined = process.argv[modeIndex + 1];
  if (mode === 'custom-cert' || mode === 'custom-http' || mode === 'internal' || mode === 'managed') {
    return mode;
  }

  throw new Error('Expected --mode to be custom-cert, custom-http, internal, or managed.');
}
