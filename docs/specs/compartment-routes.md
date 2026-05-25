# Compartment Routes

`compartment.routes.yml` is the optional browser-facing routing companion to `compartment.yml`. It declares public host path routing between project services; it does not declare private service topology.

## Scope

- It owns only browser-facing path routing from one hosted service to another.
- It is optional. No file means no extra proxy rules.
- It complements the descriptor; service existence and service kind still come from `compartment.yml`.

## Invariants

- Rules are ordered and first-match wins.
- Matching and rewriting operate on a normalized safe request path.
- A rule may apply method filtering and at most one path transform.
- Query strings survive rewrites.
- Only routable hosted services may participate. Worker-style internal services are not valid browser proxy targets.

## Boundary Decisions

- Validation happens before runtime execution and rejects ambiguous or unsafe path transforms.
- Access is decided on the source hosted route and on the matched destination service route before traffic reaches the destination service.
- A public source route may proxy to an authenticated destination, but the matched request still requires destination app access before edge forwards it.
- Edge remains the policy owner for route choice, access checks, and trusted upstream headers.
- Caddy remains a transport proxy and must not duplicate routing policy from edge.

## Non-Goals

- Private service-to-service Docker networking as a user contract.
- A general ingress programming model beyond ordered path routing and rewrites.
- Per-app custom auth at the ingress boundary.
