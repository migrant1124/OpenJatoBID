# PRD Workflow

## Scope

Use this reference only to define or revise product requirements. This phase may inspect existing behavior and documentation, but it does not authorize source-code changes, dependency changes, technical architecture, or implementation planning.

## Goal

Produce a decision-ready PRD that states what outcome is required and how acceptance will be judged. The PRD is the product source of truth; it is not an implementation diary.

## Depth Selection

Keep discovery and behavior specification inside the PRD workflow instead of creating separate modes by default:

- For a narrow change, use the confirmed request or a compact PRD without requirement IDs.
- For a medium or large initiative, complete discovery first, then add observable behavior, boundaries, failure states, and acceptance criteria to the PRD.
- Add stable IDs such as `REQ-001` only when requirements must trace across plans, files, tests, or several releases.
- Create a separate behavior-specification artifact only when the PRD would otherwise become ambiguous or several systems consume the same contract.

Do not force a full discovery sequence, separate Spec, or traceability matrix onto a narrow defect, environment repair, or already-approved task.

## Intake

Start from supplied context and existing artifacts. Do not repeat questions already answered in the request, screenshots, prior PRDs, or confirmed decisions.

Resolve these topics only when they materially affect scope:

1. Who is blocked and what are they trying to accomplish?
2. What observable problem exists today?
3. What outcome matters, and why now?
4. What workflow should the user experience?
5. What is explicitly in and out of scope?
6. What must be true for the result to be accepted?
7. Which product decisions remain unresolved?

Ask one focused question per turn when user input is required. When there are several valid choices, present two or three mutually exclusive options, put the recommended option first, and explain the practical tradeoff. Challenge contradictory requirements directly.

## Evidence Rules

- Treat user-confirmed decisions as authoritative product input.
- Use current code and runtime screenshots to describe existing behavior, not to invent requirements.
- Distinguish evidence from assumption.
- Mark an assumption only when it affects scope, workflow, acceptance, or risk.
- Do not fabricate users, metrics, research, quotes, or business impact.

## PRD Structure

Use the smallest structure that makes the work unambiguous. For a major initiative, prefer:

1. Title, status, owner, and revision record.
2. Executive summary.
3. Problem statement and current evidence.
4. Target users and jobs to be done.
5. Goals and desired outcomes.
6. Scope and user-visible workflow.
7. Functional requirements or user stories.
8. Acceptance criteria.
9. Success and guardrail measures.
10. Out of scope.
11. Dependencies and product risks.
12. Open questions and assumptions to validate.

For a small change, collapse sections rather than filling a large template with generic prose.

When requirement IDs are justified, assign them only to independently testable product behaviors and keep them stable across revisions. Do not number headings or explanatory prose merely to create the appearance of traceability.

## Requirement Quality

Each requirement must describe observable behavior. Use Given/When/Then only when it makes a boundary or state transition clearer.

Good requirement:

> When an unauthorized employee opens the client, the login screen provides a separate authorization-request entry without exposing the main workspace.

Weak requirement:

> Build an elegant authorization module using a reusable service architecture.

The weak version mixes subjective design language and implementation decisions into a product requirement.

## Product Versus Technical Decisions

Keep these in the PRD:

- user roles and permissions;
- visible workflows and states;
- business rules, limits, expiry, and retention expectations;
- supported platforms;
- acceptance criteria and product risks.

Move these to planning artifacts:

- directory and module layout;
- framework, library, storage, protocol, and cryptography choices;
- IPC or HTTP endpoint shapes;
- file lists and implementation order;
- test commands and packaging mechanics.

If an implementation constraint changes the feasible product behavior, record the product impact in the PRD and the technical rationale in an ADR.

## Readiness Gate

A PRD is ready for approval only when:

- the primary user and problem are concrete;
- the requested outcome and user workflow are testable;
- scope and exclusions are explicit;
- acceptance criteria cover the critical path and failure states;
- assumptions are visible;
- unresolved choices are either answered or marked as blockers;
- no technical plan is masquerading as a product decision.
- requirement IDs, when used, are unique and map to observable acceptance criteria.

End the phase by summarizing confirmed decisions, open questions, and the exact PRD path. Wait for explicit approval before entering technical planning when the user requested staged delivery.
