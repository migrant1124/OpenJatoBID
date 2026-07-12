# Verification Matrix

## Purpose

Select verification by changed surface and risk. Record exact commands, exit status, key output, runtime evidence, and remaining gaps. Do not claim a check ran when it did not.

## Browser And UI Tool Selection

For one-off local renderer debugging or acceptance checks, prefer Chrome DevTools MCP against `http://127.0.0.1:5173` after `npm run dev` is running. Use the smallest useful sequence:

1. `list_pages` and `select_page`, or `navigate_page` to the local URL.
2. `take_snapshot` to inspect rendered UI text and controls before screenshots.
3. `list_console_messages` filtered to warnings/errors when checking frontend failures.
4. `list_network_requests` and `get_network_request` when the issue involves HTTP, assets, or local Agent calls.
5. `evaluate_script` only for focused, JSON-serializable checks that are hard to read from the snapshot.
6. `take_screenshot` only when visual layout evidence is required.

Use Playwright for reusable E2E coverage, saved regression scripts, CI-aligned browser tests, or long multi-step flows that should be replayed. If Chrome DevTools MCP is unavailable in the current task, record that limitation and use the next smallest valid verification method.

## Review Versus Verification

Use `review` to compare approved intent, plan, diff, tests, and evidence without making fixes. Use `verify` to run checks and collect evidence. A review may identify missing verification; verification does not replace a requirement or code review.

## Matrix

| Changed surface | Minimum focused check | Additional proof when behavior is user-visible or cross-process |
| --- | --- | --- |
| Skill or Markdown workflow | Current Codex `quick_validate.py`; local relative-link check | Invoke representative `prd`, `change`, `build`, `review`, and `verify` modes and inspect routing/output boundaries |
| Codex custom agent TOML | Parse TOML; confirm required fields and unique agent name | Confirm reviewer is read-only and perform a representative spawn when subagents are available |
| Client Renderer or TypeScript | `cd client; npm run build` | `npm run dev`, HTTP 200 on `127.0.0.1:5173`, Chrome DevTools MCP snapshot/console/network inspection, Electron window when Electron-specific behavior matters |
| Client Electron Main, preload, or IPC | `node --check` for every touched `.cjs`; `cd client; npm run build` | `npm run dev`, exercise the IPC/window flow, inspect `.tmp` and app logs, use Chrome DevTools MCP for renderer-visible effects |
| Existing Client Node test | `node --test <specific-test-file.cjs>` | Run neighboring service tests when a shared contract changed |
| Management logic or Electron service | `cd management; npm test`; `npm run build` | `npm run dev`, HTTP 200 on `127.0.0.1:5174`, Electron window, LAN/API flow evidence |
| Analytics Worker or dashboard | Use the affected package's existing test/build/dev scripts | Verify event ingestion, aggregation, dashboard output, and equivalent statistics; do not deploy without approval |
| Dependency or package metadata | Relevant install/build plus `npm audit` when requested by project rules | Confirm lockfile diff, native rebuilds, packaging, and licenses; never run `npm audit fix` automatically |
| OpenCode Agent runtime | Binary verification script when relevant; focused service checks | Confirm process command line, runtime port, Agent request, output, and absence of warmup errors |
| Windows packaging | Package-specific `dist:win` command | Installer/portable launch, resources, data path, upgrade behavior, and hashes when required |
| macOS packaging | Package-specific macOS build on suitable hardware/CI | Launch, signing/notarization status, resources, and architecture coverage |
| Documentation only | Link/path checks and factual comparison with current code | Render or inspect tables, Mermaid, screenshots, and referenced commands when applicable |

Use the repository's current package scripts as authority. If a command in this matrix no longer exists, update the plan or this reference instead of inventing a replacement silently.

## Runtime Evidence

For a local desktop application, combine signals:

- server endpoint responds;
- expected Electron process and child processes exist;
- target window opens and renders;
- Chrome DevTools MCP snapshot, console, or network output confirms the browser-visible state when relevant;
- console and application logs contain no new critical errors;
- the requested workflow succeeds from the user-visible entry point;
- persisted state or output files contain the expected result;
- screenshots are captured when visual acceptance matters.

One green signal is not enough for a multi-process flow.

## Failure Handling

When a check fails:

1. Preserve the full error and command.
2. Determine whether the failure is caused by the current change, baseline state, environment, or an external dependency.
3. Fix only when the current request authorizes that scope.
4. Re-run the failed check after a relevant change.
5. Report any remaining failure without hiding, downgrading, or bypassing it.

Warnings are not failures when the command exits successfully and the warning is known and unrelated, but record warnings that affect release, security, data integrity, or user-visible behavior.

## Test Report

For a substantial phase or release candidate, write a test report under `docs/secondary-development/test-reports/` containing:

1. Scope and build identifier.
2. Environment and prerequisites.
3. Commands and results.
4. Runtime and visual evidence.
5. Acceptance criteria coverage.
6. Failures, warnings, and residual risk.
7. Final verdict: passed, passed with documented limitations, or failed.

Do not use “passed with limitations” to conceal an unmet mandatory acceptance criterion.
