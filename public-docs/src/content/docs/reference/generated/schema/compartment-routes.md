---
title: 'compartment.routes.yml'
description: 'Generated reference for the current compartment.routes.yml contract.'
---

This page is generated from the current routes contract factory in the repository.

Related guides:

- [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/)
- [Route Rules: compartment.routes.yml](/deploy-apps/route-rules/)

## File

- Name: `compartment.routes.yml`
- Location: current directory
- Optional: `true`
- Created by `compartment init`: `false`

## Example

```yaml
version: 1

routes:
  - on: web
    path: /api/*
    to: api
    stripPrefix: /api

  - on: web
    path: /health
    to: api
    rewrite: /ready
```

## Rules

- Version must be `1`.
- Routes must contain at least one entry: `true`.
- Route fields: on, path, to, methods, stripPrefix, replacePrefix, rewrite.
- Required route fields: on, path, to.
- Methods are optional: `true`.
- Path forms: exact_path, prefix_path.
- Supported methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT.
- Transform fields: replacePrefix, rewrite, stripPrefix.
- Max transforms per route: 1.

## Validation Notes

- version must be 1
- routes must be a non-empty array
- every path must start with /
- Transform paths must be concrete upstream paths and must not end with /\*.
- Only one of rewrite, stripPrefix, or replacePrefix may be set.
- stripPrefix and replacePrefix require a prefix path ending with /\*.
- stripPrefix must exactly match the route path prefix.
- on and to must exist in compartment.yml
- only web, api, and static services are currently routable as on or to

## Matching Semantics

- rules are evaluated in file order
- first match wins
- incoming request paths are matched against the raw forwarded path after rejecting ambiguous dot-segments and encoded or literal path separators
- exact paths match exactly
- prefix paths ending with /\* match either the prefix itself or any deeper path
- method filtering runs before path rewriting
- query strings are preserved when a rule rewrites the path
- when a rule matches, Compartment checks access for both the source route and the target service route before proxying
- a public source route that proxies to an authenticated target still requires login on the source app route and app.route.access for the target route scope

## Transform Semantics

- rewrite replaces the entire upstream path
- stripPrefix removes the matched prefix
- replacePrefix swaps the matched prefix for a new prefix
- when no transform is set, the original safe request path is forwarded unchanged

## Related Files

- `compartment.yml`
