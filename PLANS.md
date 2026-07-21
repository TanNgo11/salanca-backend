# Execution Plans

Use an execution plan for work that spans multiple modules, changes persistence or schemas, introduces a migration, affects security or permissions, or needs more than one focused implementation pass.

Small, isolated fixes do not need ceremonial plans. A plan that merely restates the request is useless.

## Plan rules

- Base the plan on the current repository, `docs/STATUS.md`, and the active phase specification.
- Separate confirmed facts, assumptions, and owner decisions.
- Keep work inside the approved phase and list non-goals.
- Split implementation into independently verifiable steps.
- Name affected files or modules when known.
- Cover data compatibility, migration, rollback, security, documentation, and manual UAT when applicable.
- Record exact commands and observable acceptance criteria, not "test thoroughly".
- Update the plan when repository evidence invalidates an assumption.
- Do not mark it complete while required manual or external gates remain open.

## Template

```md
# <Change title>

Status: Draft | Approved | In progress | Automated verification passed | Ready for manual UAT | Complete
Owner: <name or unresolved role>
Last updated: YYYY-MM-DD
Related phase: <link>

## Goal

<Concrete user or product outcome.>

## Non-goals

- <Explicitly excluded work.>

## Current evidence

- <Relevant code, schema, test, decision, or observed behavior.>

## Decisions and assumptions

- Decision: <accepted decision and source>
- Assumption: <assumption and how it will be verified>
- Owner decision required: <decision, owner, and blocking point>

## Invariants

- <Behavior, security boundary, or data rule that must remain true.>

## Implementation steps

1. <Small change>
   - Files/modules: <paths>
   - Verification: <command or observable result>
2. <Next small change>
   - Files/modules: <paths>
   - Verification: <command or observable result>

## Data and rollback

- Migration/backfill: <none or exact approach>
- Compatibility: <impact on existing data and clients>
- Rollback: <safe reversal or why forward-only>

## Verification

- Automated: <exact commands>
- Manual UAT: <operator flow>
- Evidence to record: <report or status update>

## Documentation impact

- <Files that must change, or none with reason.>

## Risks and blockers

- <Risk, mitigation, owner, and trigger.>

## Completion record

- <Implemented items>
- <Commands run and results>
- <Manual/external gates still open>
```

Store an approved phase-wide plan under `docs/phases/`. Keep temporary progress in the agent's working plan unless the user asks for a durable task document.
