# SDK Layer

SDK owns the typed client surface over shared public contracts.

- Owns request building, response parsing, and transport defaults.
- Transport defaults may include API URL, session token, current organization slug, runtime node socket path, and internal token.
- Keep the client thin and contract-driven.
- New request options must map to a real public contract or a transport concern.
- May depend on `contracts` and `utils`.
- Must not depend on `api`, `cli`, `node`, or `test-support`.
- Must not own business logic.
- Do not expose public types or helpers that runtime code does not use.
