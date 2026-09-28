# Plan-authoring migration map

과거 local authoring handoff에 분산되어 있던 공통·domain 관점을 tracked progressive-disclosure guide로 이전한
기록입니다. 이 문서는 historical source를 다시 startup dependency로 만들지 않습니다.

| Former responsibility                                                          | Canonical tracked owner               | Migration result       |
| ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------- |
| source priority, baseline, working-tree protection                             | `core.md` §§2–3                       | migrated               |
| fact/inference/gap, official evidence                                          | `core.md` §4                          | migrated               |
| Decision, OQ, release handoff                                                  | `core.md` §5                          | migrated               |
| plan/Phase/test/acceptance/checkpoint schema                                   | `core.md` §§6–10                      | migrated               |
| Next.js/React/BFF, UI state, a11y, responsive, forms, cache, Web Vitals        | `frontend.md`                         | migrated               |
| domain invariant, contract, transaction, persistence, provider, API operations | `backend.md`                          | migrated               |
| topology, runtime, network, IAM, stateful data, capacity, observability, CI/CD | `infrastructure.md`                   | migrated               |
| auth, legal, PII, moderation, abuse and sensitive telemetry                    | `cross-cutting/security-privacy.md`   | migrated               |
| provider, migration, rollout, capacity and target evidence                     | `cross-cutting/operations-release.md` | migrated               |
| cleanup/refactor evidence                                                      | `../refactor-analysis.md`             | linked; not duplicated |
| verification and review judgment                                               | `../qa.md`                            | linked; not duplicated |

## Historical source inventory

Migration 당시 확인한 former handoff signatures입니다. 이 값은 content-loss audit용이며 current instruction이나
freshness authority가 아닙니다.

| Former handoff                            | Lines | SHA-256 at migration inventory                                     |
| ----------------------------------------- | ----: | ------------------------------------------------------------------ |
| Frontend feature/refactor authoring       |   687 | `e24b4f05cfeff425c106e0e2ac64e535b45f28cf7c6f64334dd92e2b58a0b437` |
| Backend feature/refactor authoring        |   640 | `b308c9a6e501cb1d5dfdf4a89bc81b946f2bb28fb059968ff61adbbd46a7e796` |
| Infrastructure feature/refactor authoring |   685 | `06708a5d81efe2c17a7caeb43dfd674398c9a80b8c904ad3ac08068046a82691` |

## Lifecycle rule

- New sessions read the tracked guide, not a former local handoff.
- Former local handoffs were retired after the inventory hashes, representative contract tests, and clean-process discovery smoke
  confirmed that their common and domain responsibilities had tracked owners.
- An optional ignored historical archive may retain the source text, but clean clones and current planning never depend on it.
- Historical task plans may mention the former handoffs as provenance, but they do not restore those files or instruction authority.
- New planning guidance is added to one canonical owner and linked from related guides rather than copied.
- A migration is complete only when representative contract tests protect discovery and domain-specific coverage.
