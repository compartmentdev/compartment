# Worker Layer

The worker layer owns asynchronous deployment execution after a deployment becomes eligible to run. It is the system boundary for git-source sync and resolution, build orchestration, and deployment handoff.

## Owns

- Deployment claim, progress, completion, and failure orchestration.
- Git-source sync and source resolution needed to produce a buildable deployment snapshot.
- Source snapshot preparation and handoff into build and runtime deployment flows.
- Coordination across shared contracts and SDK clients needed to move a deployment from queued work to applied runtime state.

## May depend on

- `contracts`
- `sdk`
- `source-archive`
- `docker`
- `utils`

## Must not

- Reach into API internals directly instead of going through shared contracts or SDK surfaces.
- Spread deploy orchestration across other layers when worker ownership can hold the full async flow.
- Embed backend-specific CLI details into orchestration logic when those effects can live behind worker-owned helpers or shared adapters.
- Add test-only production dependency bags or widen runtime entrypoints for tests.

## Ownership rules

- Keep orchestration decisions in worker-owned services.
- Keep external side effects behind package-local helpers or shared adapter packages.
- Tests should mock worker-owned modules or stable adapters rather than reshaping runtime entrypoints.
