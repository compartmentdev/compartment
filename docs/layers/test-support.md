# Test Support Layer

Owns:

- DB test helpers;
- database reset/bootstrap utilities;
- test-only environment resolution;
- docker test namespace lifecycle;
- free-port helpers.

May depend on:

- `docker`, for the current-context Docker Engine client used by docker namespace lifecycle helpers;
- `utils`;
- test-only third-party runtime helpers such as `pg`.

Must not:

- leak into production runtime imports;
- become a hidden dependency of app code;
- own public runtime behavior;
- own package-specific command, route, or system-test harnesses unless the layer contract is expanded first.

Change checklist:

- keep test seams explicit;
- do not export helpers from runtime packages only for tests when they can live here instead;
- keep package-owned harnesses local when they primarily encode one package's command,
  HTTP, or end-to-end testing shape;
- prefer behavior, contract, integration, and e2e coverage over forwarding and plumbing mirrors;
- delete or rewrite tests that only pin mocked call order, forwarded argument bags, or ORM choreography;
- runtime dead-code checks intentionally ignore this layer.
