import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compartmentAppCallbackPathname,
  compartmentAppLogoutPathname,
  compartmentIngressAuthorizePathname,
  compartmentIngressAuthorizeResponseHeaderNames,
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
const renderedCaddyfile: string = renderCaddyfile();

if (process.argv.includes('--stdout')) {
  process.stdout.write(renderedCaddyfile);
} else {
  writeFileSync(caddyfilePath, renderedCaddyfile);
}

function renderCaddyfile(): string {
  return trimLeadingNewline(`
{
	admin {$COMPARTMENT_CADDY_ADMIN_ADDR:localhost:2019}
	auto_https off
	metrics
	servers {
		trusted_proxies static private_ranges
		trusted_proxies_strict
		client_ip_headers X-Forwarded-For
	}
}

:{$COMPARTMENT_CADDY_HTTP_PORT} {
	vars public_scheme http
	@ingress_https header X-Forwarded-Proto https
	vars @ingress_https public_scheme https
	request_header -Forwarded
	request_header -X-Forwarded-Host
	request_header -X-Forwarded-Proto
	request_header -X-Forwarded-For

	@compartment_host host console.{$COMPARTMENT_BASE_DOMAIN}
	handle @compartment_host {
${indentBlock(renderCompartmentPublicRouteBlock(), '\t')}
	}

	@application_host host *.{$COMPARTMENT_BASE_DOMAIN}
	handle @application_host {
${indentBlock(renderHostedAppRouteBlock(), '\t')}
	}

	handle {
		respond 404
	}
}
`);
}

function renderCompartmentPublicRouteBlock(): string {
  return trimTemplateBlock(`
	route {
		@compartment_public_paths path ${renderCompartmentPublicPathMatchers()}
		handle @compartment_public_paths {
			reverse_proxy {$COMPARTMENT_API_INTERNAL_HOST}:{$COMPARTMENT_API_PORT} {
				header_up X-Forwarded-Host {host}
				header_up X-Forwarded-Proto {vars.public_scheme}
				header_up X-Forwarded-For {client_ip}
			}
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
		compartment_rate_limit {
			app_requests_per_second {$COMPARTMENT_EDGE_APP_REQUESTS_PER_SECOND}
			app_burst {$COMPARTMENT_EDGE_APP_BURST}
			client_requests_per_second {$COMPARTMENT_EDGE_CLIENT_REQUESTS_PER_SECOND}
			client_burst {$COMPARTMENT_EDGE_CLIENT_BURST}
			app_in_flight {$COMPARTMENT_EDGE_APP_IN_FLIGHT}
		}

		@compartment_edge_paths path ${compartmentAppCallbackPathname} ${compartmentAppLogoutPathname}
		handle @compartment_edge_paths {
			reverse_proxy {$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT} {
				header_up X-Forwarded-Host {host}
				header_up X-Forwarded-Proto {vars.public_scheme}
				header_up X-Forwarded-For {client_ip}
			}
		}

		request_header -X-Compartment-*

		forward_auth {$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT} {
			uri ${compartmentIngressAuthorizePathname}
			header_up Host {host}
			header_up X-Forwarded-Host {host}
			header_up X-Forwarded-Proto {vars.public_scheme}
			header_up X-Forwarded-For {client_ip}
			copy_headers {
${renderIngressAuthorizeResponseHeaders()}
			}
		}

		@compartment_proxy_path header_regexp compartment_proxy_path ${compartmentProxyPathHeaderName} ^/.*$
		rewrite @compartment_proxy_path {header.${compartmentProxyPathHeaderName}}

		reverse_proxy {header.${compartmentUpstreamHostHeaderName}}:{header.${compartmentUpstreamPortHeaderName}} {
${indentBlock(readCaddyPlatformAppCookieStripDirectives().join('\n'), '\t\t\t')}
			header_up X-Forwarded-Host {host}
			header_up X-Forwarded-Proto {vars.public_scheme}
			header_up X-Forwarded-For {client_ip}
			header_up -${compartmentProxyPathHeaderName}
			header_up -${compartmentUpstreamHostHeaderName}
			header_up -${compartmentUpstreamPortHeaderName}
		}
	}
`);
}

function renderCompartmentPublicPathMatchers(): string {
  return [
    ...edgePublicControlPlaneExactPathnames,
    ...edgePublicControlPlanePrefixPathnames.flatMap((pathname: string): string[] => [pathname, `${pathname}/*`]),
    ...edgePublicControlPlaneNestedPrefixPathnames.map((pathname: string): string => `${pathname}/*`),
  ].join(' ');
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
