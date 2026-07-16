# Contributing to Compartment

Thanks for taking the time to improve Compartment. This project is a deployment platform, so small, well-scoped changes are much easier to review and safer to ship than broad rewrites.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Discuss large features, new public contracts, or behavior that crosses package boundaries before implementation.
- Keep one pull request focused on one behavior or one documentation improvement.
- Do not include local secrets, real credentials, production tokens, or generated `.env` files.

## Ways To Contribute

Useful contributions include:

- bug fixes that preserve existing package boundaries;
- CLI, SDK, API, or Console improvements that follow the CLI-first product model;
- public documentation updates for shipped workflows;
- examples that show realistic `compartment.yml` or `compartment.routes.yml` usage;
- repository documentation updates to [README.md](./README.md) or this guide.

## Local Setup

Use the Node version pinned in `.nvmrc` and pnpm from `package.json`.

```bash
nvm use
pnpm install
cp .env.example .env
```

Local API development also needs PostgreSQL reachable through `COMPARTMENT_DATABASE_URL` and these tools on `PATH`:

```bash
brew install caddy
curl -sSL https://railpack.com/install.sh | sh
```

Start the local stack:

```bash
pnpm dev
```

A Docker-compatible daemon and CLI are required for the loopback artifact registry used by `pnpm dev` and for the
k3d platform suites. Docker is build and test infrastructure only; Compartment does not run a separate host runtime.

Read [docs/specs/local-development.md](./docs/specs/local-development.md) for the current local runtime contract.

## Code Ownership

Before editing code, find the owning package and read its layer document under [docs/layers](./docs/layers/). Those files, plus [docs/specs/type-placement.md](./docs/specs/type-placement.md), are the source of truth for package boundaries and type placement.

Core ownership rules:

- Product workflows are CLI-first. Add or extend the CLI command and shared SDK/API contract before adding Console-only behavior.
- Keep routes and commands thin: validate boundary input, map transport concerns, and call application code directly.
- Keep business logic in services.
- Keep database reads and writes in adjacent `queries/` modules.
- Put public contract types in explicit named interfaces or types.
- Declare real cross-package dependencies in the owning package `package.json`.
- Keep public ingress explicit. Never expose `/internal/*`, internal-token routes, or control-plane health routes publicly.

If a change needs a boundary violation, duplicated logic in another package, or a new cross-package shortcut, propose the refactor first.

## Permissions, Auth, And Public Routes

When a change adds or alters permissions, explicitly decide in the same pull request whether existing or seeded principals and groups receive that permission by default.

When a public route handles authentication, tokens, passwords, invites, login codes, sessions, or organization membership, make an abuse-protection decision in the same pull request. Add rate limiting or cooldown behavior, or explain why neither is needed.

## Docs And Contracts

Update related surfaces in the same change:

- Contract schema change: update SDK consumers and contract tests.
- Database schema change: update migrations and affected API tests.
- CLI JSON output change: update fixtures and smoke coverage.
- Auth or organization-context change: update API, CLI, and integration coverage together.
- Shipped user-visible behavior change: update `public-docs/`.
- Generated public reference change: regenerate the reference instead of hand-editing generated files.

Public user docs live in `public-docs/`. Engineering docs live in `docs/`.

## Repository Documentation

Use the smallest documentation surface that matches the change:

- Update [README.md](./README.md) for the project overview, quickstart, repository layout, and useful external links.
- Update [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor workflow, validation, review, and maintainer expectations.
- Update `public-docs/` for shipped user-facing behavior and task guides.
- Update `docs/` for internal architecture, ownership, and operating notes.

## Validation

Run the narrowest checks that match your change.

For a package change:

```bash
pnpm --filter @compartment/<package> lint
pnpm --filter @compartment/<package> typecheck
pnpm --filter @compartment/<package> test
```

For root scripts:

```bash
pnpm lint:scripts
pnpm typecheck:scripts
pnpm test:scripts
```

For public docs:

```bash
pnpm docs:build
```

Use the heavier suites only when the change requires them:

- `pnpm test:db` for DB-backed API integration or CLI smoke changes.
- `pnpm platform:e2e:up` plus the focused k3d suite for deploy, build, or runtime changes.
- `pnpm check:ci` only when CI-parity validation is explicitly needed.

## Commit Messages

Use Conventional Commits:

```text
type(scope): subject
```

Allowed types are `feat`, `fix`, `perf`, `release`, `refactor`, `style`, `test`, `build`, `ci`, `docs`, and `chore`.

Allowed scopes are package-owned scopes (`api`, `cli`, `console`, `contracts`, `docker`, `edge`, `eslint-config`, `eslint-plugin`, `kube-runtime`, `sdk`, `source-archive`, `test-support`, `utils`, `worker`, and `public-docs`) plus root-owned scopes (`scripts`, `root-config`, `docs`, `examples`, and `release`).

Examples:

```text
docs(docs): refresh project readme
fix(cli): preserve deploy target selection
feat(api): add organization invite expiry
```

## Pull Requests

Include:

- what changed and why;
- the user-visible behavior, if any;
- validation commands you ran;
- screenshots or recordings for Console changes;
- links to related issues or design notes.

Keep the branch current with the target branch and respond to review feedback with follow-up commits. Maintainers may ask for scope reductions when a pull request mixes unrelated behavior.

## Security Issues

Do not open a public issue for vulnerabilities or secret exposure. Use GitHub private vulnerability reporting if it is enabled for the repository, or ask a maintainer for the private disclosure channel.
