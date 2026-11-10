---
id: P0-03
title: Review and preserve the existing workspace changes
phase: 0
type: owner
status: todo
size: S
depends_on: [P0-01]
spec: [4, 6]
---

# P0-03: Review and preserve the existing workspace changes

## Outcome

Establish which existing monorepo and dashboard changes belong to this project before implementation starts.

## Likely files

- `docs/decisions/workspace-baseline.md (new)`
- `existing files are read-only until separately approved`

## Acceptance criteria

- [ ] Inventory staged, unstaged and untracked changes without discarding or rewriting them.
- [ ] Record the owner's decision about preserving the existing monorepo scaffold and unrelated work.
- [ ] Leave commits, resets, deletions, directory renames and stashes for separately authorized actions.

## Verification

Compare git status --short before and after the review; only the approved decision note should be new.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
