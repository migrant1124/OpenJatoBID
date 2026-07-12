# Independent Review Workflow

## Scope

Use this reference to review product, planning, implementation, or delivery work without fixing it. Review is read-only unless the user separately authorizes corrections. Lead with concrete findings; do not bury failures under a summary.

## Review Depth

Use the main task for routine, narrow reviews. Use the project custom agent `openjatobid_reviewer` for a substantial final, release, cross-process, security-sensitive, or explicitly requested independent review when subagents are available.

An independent reviewer must receive the raw approved artifacts, current diff, tests, and evidence needed for the task. Do not pass the developer's conclusions or expected answer. If the custom agent cannot run, say that the review used the main context and do not claim independence.

## Sources

Inspect the smallest authoritative set:

1. newest user request and explicit phase boundary;
2. applicable `AGENTS.md` and development guide;
3. approved PRD or confirmed requirement;
4. ADR, API, design, `tasks/plan.md`, and `tasks/todo.md` when relevant;
5. current diff and affected code paths;
6. focused tests, build output, runtime evidence, logs, and unresolved warnings.

## Review Sequence

1. Reconstruct the intended behavior and exclusions without relying on the implementation narrative.
2. Inspect the actual diff and trace each material change to an approved requirement or task.
3. Check for missing behavior, regressions, scope expansion, stale documents, and invalidated tests.
4. Evaluate whether the verification proves the user-visible and cross-process behavior claimed.
5. Check recovery or rollback for persisted data, contracts, dependencies, packaging, and release changes.
6. Apply the conditional compliance checks below only when their owning surface is affected.
7. Report findings by severity with file and line references, impact, evidence, and a concise correction direction.

## Conditional Compliance

Always check project-level invariants that match the changed surface: Analytics is preserved, errors and validators are not hidden, Git and dependency boundaries were respected, and implementation did not exceed approved scope.

Only when the change touches prompts, AI-generated bid content, evidence handling, document export, or final-content status, check for:

- fabricated or unsupported facts;
- missing source labels for customer, project, amount, contact, or internal data;
- unauthorized competitor names or sensitive terms;
- AI-generated content incorrectly marked as final instead of pending human review;
- removal or weakening of required review or audit evidence.

Do not apply bid-content checks to unrelated environment repair, styling, packaging, or infrastructure work.

## Findings And Verdict

Use these severities:

- `P0`: blocks use or delivery and can cause catastrophic data, security, or compliance impact;
- `P1`: breaks required behavior or a mandatory acceptance criterion;
- `P2`: meaningful regression, missing test, maintainability, or operational risk;
- `P3`: minor issue worth fixing but not release-blocking.

List findings first, ordered by severity. Then state open questions or assumptions, verification gaps, and a short verdict. If no issue is found, say so directly and identify residual risk or untested paths.

Create `docs/secondary-development/reviews/` on demand and write `<topic>-review.md` for a substantial phase or release review. Keep routine review output in the task response unless a durable artifact is requested.
