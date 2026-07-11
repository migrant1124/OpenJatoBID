---
name: openjatobid-secondary-development
description: Guide OpenJatoBID secondary development from PRD and technical planning through scoped implementation, browser/Electron debugging, Chrome DevTools MCP inspection, verification, and handoff. Use for project-specific requirements, plans, builds, regressions, local runtime checks, or acceptance work in this repository.
---

# OpenJatoBID Secondary Development

## Purpose

Run OpenJatoBID secondary-development work through one project-specific workflow instead of stacking generic product and engineering playbooks. Preserve explicit phase boundaries, load only the guidance needed for the current phase, and require concrete evidence before calling work complete.

## Instruction Precedence

Apply instructions in this order:

1. The user's current request and explicit phase boundary.
2. The nearest applicable `AGENTS.md`.
3. `client/开发说明.md` when work touches `client/`.
4. Confirmed PRDs, ADRs, API contracts, design baselines, and task plans.
5. This skill and its references.

Stop and surface the conflict when two sources at the same level disagree. Do not silently choose a convenient interpretation.

## Input

Use context already provided by the user, existing repository artifacts, and current code. Do not re-ask answered questions.

Useful inputs include:

- the requested mode or stage;
- a feature idea, defect, or environment symptom;
- a PRD, task ID, plan, screenshot, log, or acceptance criterion;
- constraints on scope, files, Git operations, dependencies, or verification.

If a material product choice cannot be recovered from the repository, ask one concise question. If the task is actionable and the remaining uncertainty does not change scope or behavior, proceed with the safest repository-consistent assumption and state it.

## Select The Mode

Choose exactly one active mode unless the user explicitly requests the full workflow.

| Mode | Use when | Load |
| --- | --- | --- |
| `prd` | Defining or revising product requirements | `references/prd-workflow.md` |
| `plan` | Converting an approved PRD into architecture and tasks | `references/planning-workflow.md` |
| `build` | Implementing an approved task or plan | `references/build-workflow.md`, then `references/verification-matrix.md` |
| `debug` | Diagnosing and fixing an observed failure | `references/build-workflow.md`, then `references/verification-matrix.md` |
| `verify` | Testing, reviewing, or collecting acceptance evidence only | `references/verification-matrix.md` |
| `full` | Running PRD through delivery with explicit approval gates | Load each reference only when its phase begins |

Do not force a PRD for a narrow defect, environment repair, read-only review, or already-approved task. Do not enter `build` merely because a PRD or plan was requested.

## Browser Debugging Tool Choice

Prefer Chrome DevTools MCP for interactive local UI inspection when a Vite/browser renderer page is available, especially `http://127.0.0.1:5173`. Use it to navigate or select the page, take an accessibility snapshot, inspect console messages, inspect network requests, run small page-side JavaScript checks, and capture screenshots only when visual evidence is needed.

Use Playwright when the task requires repeatable scripted end-to-end coverage, CI-ready regression tests, multi-step automation that must be saved as code, or browser behavior that Chrome DevTools MCP cannot drive reliably. If Chrome DevTools MCP is unavailable in the current task, state that directly and fall back to the smallest valid browser or process-level check.

Chrome DevTools MCP is usually more token-efficient for one-off debugging because it can return targeted console, network, snapshot, and evaluation data without generating or explaining a full test script. Playwright is usually more efficient for repeated regression suites because the script becomes reusable evidence.

## Workflow

### 1. Preflight

Before changing state:

1. Read the applicable repository instructions and current phase artifacts.
2. Inspect `git status --short` and preserve all existing user changes.
3. Identify the actual scope: `client/`, `management/`, `analytics/`, documentation, packaging, or environment only.
4. Confirm the success condition and prohibited actions from the current request.

For review, explanation, status, planning, and diagnosis requests, remain read-only unless the user also asks for implementation.

### 2. Product Definition

Use `prd` mode to capture user problem, target users, desired behavior, scope, exclusions, acceptance criteria, risks, and unresolved product decisions. Keep implementation structure, file lists, API shapes, and task ordering out of the PRD unless the user explicitly requests a combined artifact.

Stop at the PRD approval gate. Do not write source code.

### 3. Technical Planning

Use `plan` mode only after requirements are sufficiently confirmed. Inspect the real code before deciding architecture. Put durable structural decisions in ADRs, cross-process contracts in API docs, visual decisions in design docs, and executable sequencing in `tasks/plan.md` plus `tasks/todo.md`.

Stop at the plan approval gate. Do not write source code.

### 4. Build Or Debug

Use `build` or `debug` mode for the smallest approved vertical slice. Follow existing patterns, keep every edit traceable to the request, and verify after each behaviorally meaningful increment. Do not add speculative abstractions, dependencies, feature flags, security layers, or fallback paths.

Do not create branches, commits, tags, pushes, merges, rebases, or resets unless the user's current request explicitly authorizes that exact Git action.

### 5. Verify And Handoff

Select checks from `references/verification-matrix.md` according to the files and behavior changed. Record commands, exit status, runtime evidence, and unresolved warnings. A green build alone is not runtime proof when the task involves Electron, IPC, browser UI, OpenCode, networking, or packaging.

Finish with:

- outcome and user-visible behavior;
- files or artifacts changed;
- verification evidence;
- remaining risks or manual steps;
- confirmation that no out-of-scope Git or deployment action occurred.

## Non-Negotiable Boundaries

- Treat a user-defined phase boundary as a requirement.
- Once `build` begins, implement the approved plan only; route new ideas back through `plan`.
- Preserve Analytics collection, aggregation, dashboard behavior, and deployment configuration unless the user explicitly requests an equivalent replacement.
- Validate user input and genuine external boundaries. Do not duplicate validation across trusted local Renderer, preload, IPC, Main, and service layers.
- Do not change dependencies, package manifests, lockfiles, release workflows, or update channels unless required by the approved task.
- Diagnose from code, logs, process state, and reproducible behavior. Do not guess a root cause.
- Reuse project components, services, stores, prompts, styles, and IPC patterns before adding new abstractions.
- Do not hide errors, weaken checks, delete failing tests, or redefine success to make verification pass.

## Output Locations

| Artifact | Default location |
| --- | --- |
| PRD | `docs/secondary-development/prd/<topic>-prd.md` |
| Architecture decision | `docs/secondary-development/adr/<topic>.md` |
| API contract | `docs/secondary-development/api/<topic>.md` |
| Design baseline | `docs/secondary-development/design/<topic>.md` |
| Implementation plan | `tasks/plan.md` |
| Task status | `tasks/todo.md` |
| Test or acceptance report | `docs/secondary-development/test-reports/<topic>-test-report.md` |

Reuse an existing authoritative artifact instead of creating a competing source of truth.

## Examples

- `$openjatobid-secondary-development prd：通过提问帮我定义批量导入功能，先不要写代码。`
- `$openjatobid-secondary-development plan：把已确认的 PRD 转成 ADR、任务计划和验收门。`
- `$openjatobid-secondary-development build：只执行 tasks/plan.md 的 T12，并完成对应验证。`
- `$openjatobid-secondary-development debug：排查 Electron 登录后白屏，先复现和定位，再修复。`
- `$openjatobid-secondary-development verify：只验证 OpenCode Agent 启动链路，不修改源码。`

## References

- Read `references/prd-workflow.md` only for `prd` or the PRD phase of `full`.
- Read `references/planning-workflow.md` only for `plan` or the planning phase of `full`.
- Read `references/build-workflow.md` only for `build`, `debug`, or the implementation phase of `full`.
- Read `references/verification-matrix.md` whenever verification or acceptance evidence is required.
