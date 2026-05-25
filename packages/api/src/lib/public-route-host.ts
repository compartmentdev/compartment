export function buildPublicRouteHost(baseDomain: string, routeSubdomain: string): string {
  return `${routeSubdomain}.${baseDomain}`;
}

export function readPublicRouteSubdomain(host: string, baseDomain: string): string | null {
  const hostSuffix: string = `.${baseDomain}`;
  if (!host.endsWith(hostSuffix)) {
    return null;
  }

  const routeSubdomain: string = host.slice(0, -hostSuffix.length);

  return routeSubdomain === '' ? null : routeSubdomain;
}
