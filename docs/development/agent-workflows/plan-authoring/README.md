# Plan authoring

이 디렉터리는 architecture·feature·refactor 계획을 current repository evidence에서 작성하는 tracked contract를
소유합니다. 특정 task의 계획, 과거 session transcript 또는 실행 상태를 저장하지 않습니다.

## 읽는 순서

1. [Request intake](../request-intake/README.md)에서 요청 결과와 mutation authority를 확인합니다.
2. 모든 계획은 [Core](./core.md)를 읽습니다.
3. primary owner guide 하나를 선택합니다.
   - [Frontend](./frontend.md)
   - [Backend](./backend.md)
   - [Infrastructure](./infrastructure.md)
4. 요청과 evidence가 요구할 때만 cross-cutting guide를 0~2개 추가합니다.
   - [Security and privacy](./cross-cutting/security-privacy.md)
   - [Operations and release](./cross-cutting/operations-release.md)
5. cleanup/refactor 검증은 [Refactor analysis](../refactor-analysis.md), 완료 판정은 [QA](../qa.md)를 링크합니다.

domain 수가 많다는 이유만으로 guide나 child lane을 늘리지 않습니다. Primary owner가 불명확하면 read-only
inspection으로 owner를 찾고, 결과를 바꾸는 모호함은 OQ 또는 사용자 확인으로 남깁니다.

## Output boundary

- 사용자가 분석만 요청했다면 이 guide를 plan artifact 생성 권한으로 해석하지 않습니다.
- 계획은 Decision, OQ, dependency, implementation phase, test, acceptance를 포함합니다.
- 계획 작성은 구현 권한이 아닙니다.
- account·provider·production target 없이는 release 값을 추측하지 않고 future evidence handoff로 분리합니다.

## Implementation readiness review

Comprehensive plan과 `implementation-ready` plan은 같지 않습니다. 계획이 상세해도 current working tree, target tracking,
local runtime, configuration precedence, complete Phase ownership, acceptance evidence를 확인하지 못했다면 `proposed` 또는
`blocked`로 유지합니다.

1. [Core의 readiness promotion gate](./core.md#7-implementation-readiness-promotion)로 Markdown과 current evidence를
   대조합니다.
2. 필요한 경우 이를 [read-only readiness policy](../../../../scripts/agents/common/plan-readiness-policy.mjs)의 normalized input으로
   매핑해 self-contradiction을 검사합니다.
3. Validator green은 보조 evidence입니다. Fresh reviewer가 입력의 사실성, blocking OQ, mutation authority를 독립적으로
   확인한 뒤에만 구현을 시작합니다.

세부 status·evidence·enforcement matrix는 Core가 소유합니다. Root `AGENTS.md`나 domain guide에 이를 복사하지 않습니다.

## Migration

[Migration map](./migration-map.md)은 과거 local handoff의 공통·domain 관점을 이 tracked 구조로 이전한 결과를
기록합니다. 이전 local handoff는 content-loss audit와 fresh-session 검증을 마친 뒤 retired되었습니다. 이 디렉터리가
plan-authoring 규칙의 유일한 durable owner이며, 새 세션은 과거 local 경로나 사본을 찾지 않습니다.
