# Build And Debug Workflow

## Contents

- Scope and preflight
- Implementation loop
- Project boundaries
- Testing and debugging
- Stop conditions and handoff

## Scope

Use this reference for approved implementation or for diagnosis and repair of an observed failure. The current user request defines whether source changes are authorized. A request to explain, review, plan, or diagnose does not automatically authorize a fix.

## Preflight

Before editing:

1. Re-read the newest user request and active task or acceptance criterion.
2. Read `AGENTS.md`; before touching `client/`, read root `开发说明.md`, or `client/开发说明.md` in an older checkout that still uses that location.
3. Inspect `git status --short` and preserve unrelated user changes.
4. Read the relevant code path, tests, configuration, and logs.
5. Establish baseline behavior or a reproducible failure.
6. State the smallest file and behavior scope that can satisfy the task.

Do not create a branch, commit, stash, reset, merge, rebase, push, pull, tag, release, or deployment unless explicitly requested in the current message.

## Implementation Loop

For each approved increment:

1. **Prove the baseline.** Reproduce the defect, run the existing test, or capture current runtime behavior.
2. **Change one behavior.** Implement the smallest coherent vertical slice.
3. **Verify immediately.** Run the most focused valid check for the changed layer.
4. **Inspect the diff.** Remove accidental formatting, generated debris, and unrelated edits.
5. **Update execution state.** Mark the applicable item in `tasks/todo.md`, the sole execution-state source, without rewriting completed user work.
6. **Continue only if needed.** Do not expand into adjacent improvements.

A task does not require a commit to count as an increment. Buildability, focused evidence, and a reviewable diff are the checkpoints.

## Project Boundaries

### Client

- Renderer is React and TypeScript under `client/src/`.
- Electron Main and preload are CommonJS under `client/electron/**/*.cjs`.
- Renderer reaches local capabilities only through `window.yibiao`.
- IPC modules register and forward; business logic belongs in services.
- Keep shared code independent from feature modules.
- Reuse global CSS, Radix primitives, shared UI, ToastProvider, internal scrolling, and existing page patterns.
- Keep user-visible text in Chinese.
- Keep long-running AI, parsing, generation, and export work in Electron Main background tasks with persisted state.
- Use UTF-8 explicitly for Main-side file I/O and treat Windows Chinese paths as normal input.

### Management

When `management/` is in scope, read its own package scripts and architecture before editing. Preserve its separation from `client/`; do not create implicit imports between the two applications. Keep secrets, SQLite access, SMTP, and LAN service ownership in Electron Main rather than Renderer.

### Analytics

Do not delete, bypass, weaken, or silently replace event collection, queueing, aggregation, dashboards, or Worker behavior. A migration must preserve equivalent statistics and document the before/after data path.

### Validation And Trust

Validate user input, file selection, LAN or public HTTP requests, authentication, authorization, secrets, and genuinely external data at the owning boundary. Treat local Renderer, preload, IPC, Main, and service calls as trusted internal layers after input has crossed that boundary; do not repeat schema checks at every hop.

## Testing Policy

- Use a failing regression test first when a suitable existing test layer can reproduce a logic defect.
- Do not add a test framework for a style, copy, configuration, or environment-only change.
- Prefer real services and state over interaction-heavy mocks where practical.
- Test observable behavior and persisted state, not framework implementation details.
- For UI and Electron behavior, combine automated checks with runtime inspection.
- For local renderer debugging, prefer Chrome DevTools MCP against `http://127.0.0.1:5173` for targeted snapshot, console, network, and page-side evaluation evidence.
- Use Playwright when the check must become a reusable scripted regression or CI-style E2E test.
- Run only checks invalidated by the latest edit; rerunning unchanged checks adds no evidence.

## Chrome DevTools MCP Loop

Use this loop when the issue is visible in the Vite-served renderer or can be reproduced at `http://127.0.0.1:5173`:

1. Start or reuse `npm run dev`, then confirm the local URL responds.
2. Use Chrome DevTools MCP to open or select the page.
3. Capture `take_snapshot` before screenshots; use screenshots only for layout or visual proof.
4. Read `list_console_messages` for errors and warnings after the relevant navigation or interaction.
5. Read `list_network_requests` and specific request details when local Agent, asset, API, or IPC-adjacent behavior surfaces through HTTP.
6. Use `evaluate_script` for narrow state checks that cannot be established from the snapshot, console, network, logs, or files.
7. Record only the relevant output in the handoff; do not paste huge DOM dumps or full request bodies unless needed.

Chrome DevTools MCP does not replace Electron process checks, Main/preload `node --check`, `.tmp` logs, or OpenCode process verification. Use it as the first browser-visible inspection tool, then combine it with process and log evidence for cross-process failures.

## Debugging Protocol

1. Record the exact symptom, path, timestamp, and expected behavior.
2. Reproduce it using the same entry point as the user.
3. Inspect process state, console output, network or IPC path, persistent state, and relevant logs.
4. Narrow the failure to one boundary before proposing a fix.
5. Add temporary diagnostic logging only when existing evidence is insufficient.
6. Fix the root cause with the smallest change.
7. Repeat the original reproduction and run neighboring regression checks.
8. Remove noisy temporary logging unless it has durable operational value.

Never hide an error banner, comment out a validator, weaken an Agent check, delete a failing test, or replace a concrete failure with a speculative explanation.

## Stop Conditions

Pause implementation and report the blocker when:

- a new product decision would change approved behavior or scope;
- user changes make the required edit unsafe to isolate;
- a dependency, data migration, public contract, or release change lacks approval;
- required credentials, hardware, network access, or external service state cannot be obtained safely;
- verification repeatedly fails for a reason outside the authorized scope.

Do not call ordinary complexity or an incomplete first attempt a blocker.

When approved behavior, architecture, or acceptance criteria change during implementation, route the request through `change` mode and stop before source edits until the affected decision is approved.

## Handoff

Report:

- what behavior changed and why;
- the authoritative task or requirement satisfied;
- files changed;
- focused and broad verification evidence;
- remaining warnings, untested paths, or manual checks;
- any deliberately unperformed Git, release, deployment, or migration action.
