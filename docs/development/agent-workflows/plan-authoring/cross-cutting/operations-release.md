# Operations and release plan lens

Provider, migration, production target, rollout/rollback, SLO, observability, capacity 또는 operator workflow가 범위에
포함될 때 primary domain guide와 함께 읽습니다.

## Required analysis

- deployable artifact, environment, config and secret owner
- schema/data compatibility and rollout order
- health, readiness, saturation, metric/log/error signal and runbook
- timeout, retry, degradation and dependency failure behavior
- capacity assumptions, cost, quota and scale trigger
- rollback artifact, forward-fix boundary and operator authority
- local/CI/rehearsal evidence versus target-specific release evidence

## Account-free implementation and release gate

Repository에서 검증 가능한 config schema, adapter, privacy, fail-open/closed, fake/recording transport, local rehearsal을
먼저 구현할 수 있습니다. 실제 provider account, region, hostname, retention, credential, target cost는 추측하지
않습니다.

Release handoff는 다음을 명시합니다.

- release SHA or immutable artifact identity
- target/environment/region owner
- secret inventory status, value excluded
- network/TLS/health/readiness/migration/provider smoke
- metric/log/alert/dashboard and operator access
- rollback decision and known risks
- evidence absence 시 `NO-GO`

Local rehearsal 통과를 production success로 표현하지 않으며, 계정 생성이나 metric 축적 대기를 repository
implementation Phase로 만들지 않습니다.
