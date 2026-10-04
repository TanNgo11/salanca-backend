# Script cleanup

Status: Implemented and verified locally; awaiting owner review before push.
Owner decision: 2026-10-03, retire duplicate scripts and use one production seed command.
Related phase: ../phases/phase-05-seed-content.md

## Verified scope
Reference search found no runtime imports of the one-off apply/restore scripts, old deploy wrapper or demo seed. Their package aliases and historical docs are the only external callers. All candidates are Git-tracked, so removal is reversible with Git.

## Steps
1. Remove only obsolete one-off, demo and sibling deploy scripts; retain validation, backups and tested production internals.
2. Remove obsolete package aliases and update supported operator instructions to one command.
3. Run release tests, syntax checks, lint/typecheck and diff checks.

## Invariants and rollback
No CMS writes, schema changes or production execution. Keep unpublished-edit guards, recovery snapshots, S3 uploads and no-prune behavior. Git revert restores deleted tools. Production apply remains an operator gate.

## Result
Retired 19 tracked obsolete apply/restore/demo/deploy files and their package aliases. Live production internals moved under scripts/lib. The only supported production seed entry is node scripts/seed-production-content.mjs; optional --preview uses the same entry. Validation, backup and smoke tools remain available.

Final preview passed with 178 localized documents and 48 original media files. Syntax, release tests, lint, typecheck and diff checks passed. No production apply or Git push was performed.
