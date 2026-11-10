---
id: P0-09
title: Choose the authentication approach with evidence
phase: 0
type: spike
status: todo
size: M
depends_on: [P0-06]
spec: [10, 20]
---

# P0-09: Choose the authentication approach with evidence

## Outcome

Evaluate the preferred authentication option against school-scoped accounts and host-only cookies before committing to an implementation.

## Likely files

- `docs/decisions/authentication.md (new)`
- `isolated spike tests or fixtures only after their plan is approved`

## Acceptance criteria

- [ ] Use current official documentation and a focused experiment to verify duplicate login identifiers across schools and host-only sessions on separate hosts.
- [ ] Record session revocation, expiry, password hashing and future bearer-token support; explain any unsupported requirement.
- [ ] Owner approves the selected approach and exact dependencies before the implementation tickets start; do not install both alternatives by default.

## Verification

Record reproducible experiment commands and observed results; owner reviews the decision against every requirement in spec section 10.

Also follow the [shared completion rules](../README.md#completion-rules).

## Work notes

- Baseline / blockers:
- Changes:
- Commands and results:
- Next step:
