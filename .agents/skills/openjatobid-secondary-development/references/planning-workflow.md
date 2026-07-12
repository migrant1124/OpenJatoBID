# Technical Planning Workflow

## Contents

- Scope and preconditions
- Sources of truth
- Planning steps
- Test strategy
- Planning gate

## Scope

Use this reference to convert confirmed requirements into an implementation-ready plan. Planning may create or revise ADRs, API contracts, design documents, and task files. It may report a PRD gap, but it must route product-behavior changes back through `prd` or `change` instead of revising the approved PRD in place. Planning does not authorize product source-code changes.

## Preconditions

Before planning:

1. Identify the authoritative PRD or confirmed requirement.
2. List unresolved product decisions that block architecture.
3. Read `AGENTS.md` and the applicable development guide.
4. Inspect the real package scripts, relevant source modules, existing tests, and current `git status`.
5. Confirm whether the task affects `client/`, `management/`, `analytics/`, packaging, migration, or several of them.

Do not design from filenames alone. Trace current entry points, data ownership, process boundaries, and verification paths.

## Sources Of Truth

Keep each decision in one place:

| Decision | Artifact |
| --- | --- |
| User problem, workflow, scope, business rule | PRD |
| Durable architectural choice and alternatives | ADR |
| HTTP, IPC, event, or file contract | API document or shared type |
| Visual baseline, tokens, responsive behavior | Design document |
| Sequencing, dependencies, files, checks | `tasks/plan.md` |
| Current execution state | `tasks/todo.md` |

Link between artifacts; do not copy whole decision tables into every file.

Treat `tasks/todo.md` as the sole execution-state source. Do not create `state.yaml`, `audit.jsonl`, or another progress ledger unless the user has approved a deterministic workflow engine that consumes it.

## Planning Steps

### 1. Establish The Baseline

Document only facts needed for the change:

- current behavior and ownership;
- affected entry points and authoritative stores;
- relevant constraints from `AGENTS.md` and development docs;
- existing test and runtime commands;
- user changes already present in the worktree.

### 2. Resolve Architecture

For each structural decision, record:

- context and constraint;
- chosen option;
- alternatives rejected and why;
- compatibility and migration impact;
- reversal or recovery approach when relevant.

Do not add an abstraction unless it removes real duplication, enforces an existing boundary, or supports a confirmed cross-module contract.

### 3. Slice Vertically

Prefer increments that produce observable behavior across the necessary layers. Use risk-first ordering when a dependency, native module, data migration, IPC contract, network boundary, or packaging constraint could invalidate later work.

Avoid horizontal plans such as “build all types, then all services, then all UI” unless a shared contract must be frozen first.

### 4. Write Executable Tasks

Each task should contain:

- stable ID and concise title;
- the exact approved requirement or acceptance criterion it satisfies;
- objective and user-visible result;
- in-scope files or ownership areas;
- dependencies and prerequisites;
- implementation notes limited to confirmed decisions;
- focused verification commands and runtime evidence;
- acceptance condition;
- size or risk marker when useful.

Do not require a Git commit per task. Commits, branches, pushes, and releases remain user-authorized operations.

When the PRD uses requirement IDs, carry those IDs into the affected tasks and verification evidence. When it does not, cite the exact PRD section or confirmed acceptance criterion instead of inventing IDs during planning.

### 5. Add Decision Gates

Place explicit checkpoints before:

- changing a public or cross-process contract;
- migrating or deleting persisted data;
- replacing Analytics behavior;
- adding or changing dependencies;
- modifying release, update, signing, or deployment behavior;
- broad visual migration after a representative baseline has not been approved.

## Test Strategy

Use existing infrastructure. Do not introduce a test framework merely to satisfy a generic workflow.

- For a defect, require reproducible evidence before the fix and repeat it after the fix.
- For logic with existing test support, specify a focused regression test.
- For UI, IPC, Electron, OpenCode, networking, or packaging, include runtime proof in addition to build output.
- Scale verification with the blast radius and cross-module surface.

Use `references/verification-matrix.md` to select exact checks.

## Planning Gate

The plan is ready for approval when:

- every task traces to an approved requirement;
- dependency order and decision gates are explicit;
- affected files and ownership boundaries were verified against the repository;
- validation matches the actual package scripts and runtime;
- rollback or recovery exists for risky state changes;
- no unresolved product decision is hidden as a coding assumption;
- out-of-scope work is visible.

End by reporting the artifacts created or revised, the first executable task, and any blocker. Wait for approval before implementation when the user requested a plan-first workflow.
