---
title: 'Route Rules: compartment.routes.yml'
description: Optional browser-facing routing rules for apps that need more than the default host mapping.
---

`compartment.routes.yml` is optional.

Use it only when the default host-based routing is not enough.

Common cases:

- send `/api/*` to one service and `/` to another;
- expose multiple browser paths from one project;
- rewrite request paths before proxying upstream;
- limit a route to specific HTTP methods.

Route rules can target browser-facing `web`, `api`, and `static` services.
That means a static frontend can keep `/` while proxying `/api/*` to a separate API service from the same project.

Access is still enforced on the matched target service.
If a public frontend proxies `/api/*` to a service with `accessMode: authenticated`, those proxied requests require app login and `app.route.access` for the target service scope before Compartment forwards them.

It owns:

- route match rules;
- supported HTTP method filters;
- path transforms for routed requests.

It does not replace `compartment.yml`. The descriptor still owns application identity and service build/run shape.

Use `compartment descriptor routes-schema` for the current contract and example shape.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Browse the [generated routes schema reference](/reference/generated/schema/compartment-routes/).
