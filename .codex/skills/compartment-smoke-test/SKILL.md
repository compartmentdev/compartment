---
name: compartment-smoke-test
description: 'Run or delegate a browser-first smoke test of the local compartment through browser-use as a real user: boot or reuse the local stack, install or log in, deploy the repo smoke fixtures, verify CLI status/logs, and exercise protected app login/logout flows.'
---

# Compartment Smoke Test

Use this skill for a real local smoke test of the compartment as a user, not just repo tests.

## Source of truth

- `AGENTS.md`
- `.env.example`
- `packages/cli/test/cli.smoke.test.ts`
- `packages/cli/test/system-user-flow.e2e.test.ts`
- `packages/cli/test/self-hosted-user-setup.e2e.harness.ts`
- `packages/cli/test/self-hosted-user-setup-k3d.harness.ts`
- `packages/api/test/api.integration.test.ts`
- `examples/dockerfile/`
- `examples/railpack/`
- `examples/python/`
- `examples/multi-service/`

## Preconditions

- Reuse a healthy local stack when possible. Otherwise start `pnpm dev`.
- Local smoke needs working Postgres, Docker, and the public ports from `.env`.
- If `.env` is missing, derive a local-only copy from `.env.example`. Do not commit `.env`.

## Delegation default

- When tool policy and the user's request allow subagents, and this skill is being invoked from a broader non-smoke task, prefer a dedicated smoke subagent instead of blocking the main agent on browser smoke.
- Do not choose or name a model, reasoning effort, speed, latency, or quality mode in this skill.
- Let the smoke subagent inherit the user's current session configuration. If the client requires explicit values, pass only the current user-selected values exposed by the client/runtime.
- Prefer a subagent type that preserves the current user-selected configuration.
- Give the smoke subagent the repo root, stack status if already known, the required scenarios, the expected output format, and an explicit requirement to use `@Browser` for local browser checks.
- If you are already the dedicated smoke subagent, or smoke testing is the only remaining task, run the smoke directly and do not re-delegate it.
- If subagents are not allowed or not available, run the smoke in the main agent.

## Credentials

- Prefer credentials explicitly provided by the user for the current run.
- Default shared smoke creds used by the repo smoke/e2e fixtures: `admin@example.com` / `supersecretpassword`.
- Use the credentials for the current platform seed or installation.
- If a platform is available, use `compartment login`.
- For the local k3d fixture, run `compartment install --dev` only when the task authorizes creating the seed.

## CLI invocation

- Set `repo_root="$(git rev-parse --show-toplevel)"`.
- Treat `pnpm --dir "$repo_root" compartment ...` as the canonical repo-local CLI path.
- Use `pnpm --dir "$repo_root" compartment ...` for auth and context commands.
- From an example directory, run project-scoped commands as `INIT_CWD="$PWD" pnpm --dir "$repo_root" compartment <command> --output json`.

## Workflow

1. Bring up or verify the stack.

- Start `pnpm dev` only if the local stack is not already healthy.
- Confirm CLI API access and browser entry at `console.<baseDomain>`; with `.env.example` defaults this is `http://console.localhost:9080`.

2. Establish CLI auth and context.

- Try `compartment whoami` first.
- If needed, run `compartment login`.
- Verify `compartment whoami`, `compartment org list`, and `compartment org use <slug>`.
- Run `compartment logout`, confirm the session is gone, then log back in.

3. Deploy the `Dockerfile` fixture.

- Use `examples/dockerfile` as the first project.
- Run `deploy --output json`, then `status --output json`, then `logs --output json`.
- Expect `routeUrl`, `dockerfile booting`, and `dockerfile listening`.
- Open the route in the browser, verify redirect to compartment login, then log in.
- After login, verify `Dockerfile` and `Deployment path is alive.`

4. Exercise browser logout.

- Trigger browser logout.
- Reopen the app route and verify it redirects to compartment login again.

5. Exercise a basic rollback on the `Dockerfile` fixture.

- Stay in `examples/dockerfile`.
- Run a second `deploy --output json` so `production/web` has a real rollback candidate.
- Run `deployment list --env production --service web --limit 5 --output json` and note the active deployment plus the previous successful non-active deployment for `web`.
- Run `rollback --env production --service web --to <previous-deployment-id> --output json`.
- Re-run `status --output json`, `deployment list --env production --service web --limit 5 --output json`, and `logs --output json`.
- Expect a fresh rollback deployment id, the requested historical deployment id to remain in history, and a new `dockerfile booting` / `dockerfile listening` sequence for the new active deployment.
- Reopen the route in the browser and verify `Dockerfile` / `Deployment path is alive.` still render after rollback.

6. Deploy the Railpack/source-build fixture.

- Use `examples/railpack`.
- Repeat `deploy --output json`, `status --output json`, `logs --output json`, and browser access checks.
- Expect `railpack booting` and `railpack listening`.
- After browser login, verify `Railpack` and `Railpack deployment path is alive.`

7. Deploy the Python Railpack fixture.

- Use `examples/python`.
- Before deploy, set a couple of runtime variables through the CLI, for example `LOG_LEVEL=debug` and `FEATURE_FLAG=enabled`.
- Repeat `deploy --output json`, `status --output json`, `logs --output json`, and browser access checks.
- Expect `python booting` and `python listening`.
- After browser login, verify `Python` and `Railpack Python deployment path is alive.`
- Verify the rendered page shows the runtime variable values you set, for example `LOG_LEVEL` -> `debug` and `FEATURE_FLAG` -> `enabled`.

8. Deploy the multi-service fixture.

- Use `examples/multi-service`.
- Run `deploy --output json`, `status --output json`, `inspect --output json`, and `logs --output json`.
- Expect two deployments in the aggregate payload: primary `web` and secondary `backoffice`.
- Expect `inspect --output json` for `web` to include the same-origin proxy rule from `compartment.routes.yml`.
- Verify the primary host stays unprefixed at `multi-service.localhost`.
- Verify the secondary host is prefixed at `backoffice-multi-service.localhost`.
- Run `status --service backoffice --output json`, `inspect --service backoffice --output json`, and `logs --service backoffice --output json`.
- Expect `multi-service web booting`, `multi-service web listening`, `multi-service backoffice booting`, and `multi-service backoffice listening`.
- Open both protected routes in the browser and verify login redirect for each route.
- After browser login, verify `Multi Service Web`, `Primary route is alive.`, and `Proxy route says: backoffice is ok.` on the primary route.
- After browser login, verify `Multi Service Backoffice` / `Secondary route is alive.` on the secondary route.

9. Run extended project smoke when the core flow is healthy.

- Run `project archive --output json`, verify `project.archivedAt` is set and `status --output json` fails with the archived-project error.
- Run `project unarchive --output json`, verify `project.archivedAt` is `null`, redeploy, and verify route/login recovery.

## Browser expectations

- Use `@Browser` with the bundled `browser-use:browser` skill for browser verification.
- Initialize browser-use with the `iab` backend through `node_repl` and keep one named session/tab for the smoke pass unless the flow requires a second tab.
- Do not switch this skill to Playwright MCP. Use shell HTTP checks only as supporting diagnostics when browser-use is blocked or when you need a fast readiness probe before opening the browser.
- Capture screenshots when login, redirect, or hosted app rendering fails.
- Healthy protected flow: app route -> compartment login -> `/_compartment/callback` -> original app path.

## Failure triage

- Environment issue: Postgres, Docker, Caddy, ports, or dead local stack.
- Product regression: auth/context commands, deploy/status/logs mismatch, broken protected-route flow, stale access after logout, wrong fixture content.

## Output

- Return a short smoke report with:
  - stack used
  - scenarios covered
  - pass/fail per scenario
  - screenshots or logs only for failures
  - environment issue vs product regression
