# Change Control Workflow

## Scope

Use this reference when an approved requirement, plan, or in-progress implementation receives a material scope, behavior, contract, or acceptance change. Treat change analysis as read-only by default. Do not edit product source until the affected product and planning decisions are approved.

## Inputs

Read only the sources needed to reconstruct the current decision:

- the user's requested change and reason;
- the approved PRD or confirmed requirement;
- applicable ADR, API, design, and planning artifacts;
- `tasks/plan.md` and the authoritative state in `tasks/todo.md`;
- current code, tests, runtime evidence, and `git status` when implementation has begun.

Do not create `state.yaml`, `audit.jsonl`, or another progress ledger. Preserve the existing user changes in the worktree.

## Classify The Change

Route the change to the earliest affected phase:

| Change type | Return to | Required action |
| --- | --- | --- |
| Clarification with no observable behavior change | Current phase | Update the current artifact only when authorized |
| User workflow, scope, business rule, role, or acceptance change | `prd` | Revise and reapprove the PRD before planning or code changes |
| Architecture, cross-process contract, persistence, dependency, or rollout change | `plan` | Revise the relevant ADR, API, design, and task plan before implementation |
| Execution detail already allowed by the approved plan | `build` | Update the affected task and continue within approved behavior |
| Test or evidence requirement only | `verify` | Update the verification scope without reopening product design |

When several classifications apply, choose the earliest phase. Do not treat an implementation shortcut as a clarification.

## Process

1. Restate the requested delta against the approved baseline.
2. List affected requirements, decisions, tasks, files, migrations, tests, and delivery evidence.
3. Identify completed work that becomes invalid, reusable, or uncertain.
4. Assign a `CHG-###` ID only when the change spans several authoritative artifacts or needs a durable approval record.
5. Present the recommended return phase, alternatives, cost, and residual risk.
6. Stop for explicit approval when the change alters product behavior, architecture, dependencies, persisted data, Analytics, release behavior, or previously accepted scope.
7. After approval, update each authoritative artifact once and synchronize `tasks/todo.md`.
8. Resume implementation only from an approved task and rerun checks invalidated by the change.

## Output

Report:

- requested delta and current baseline;
- earliest affected phase and rationale;
- impact map by artifact, task, code, test, and delivery evidence;
- work that remains valid or must be repeated;
- decision required from the user;
- exact next action after approval.

Create `docs/secondary-development/changes/` on demand and write `<topic>-change.md` only for a material cross-artifact change. For a small approved clarification, update the existing artifact revision history instead of creating another document.
