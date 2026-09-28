# Request output contracts

사용자가 요청한 결과 종류는 작업 범위와 완료 조건을 제한한다. Answer, Analyze, Plan,
Implementation을 하나의 포괄 템플릿으로 합치지 않는다.

## Common evidence labels

- **fact**: current code, contract, test, tracked policy, official dated source로 확인한 내용
- **inference**: fact에서 도출했지만 추가 검증이 필요한 해석
- **gap**: 접근할 수 없거나 아직 owner decision이 없는 정보
- **confidence**: low | medium | high; source 수가 아니라 근거의 직접성과 freshness를 반영

Source는 가능한 경우 file:line, test command, direct official URL 중 하나를 가진다.

실제 중요한 선택이 있을 때는 [Owner–Lead decision packet](../owner-lead-collaboration.md#짧은-협의-decision-packet)으로
해당 근거·대안·권장안을 짧게 보여준다. 아래 결과 종류를 대체하는 새 schema가 아니며, 간단한 Answer나 합의된 구현에
협의 양식을 강제하지 않는다. Analyze의 권장은 권한 요청이나 요청하지 않은 Plan 생성으로 확대하지 않는다.

## Answer

간단한 사실, 개념, 현재 상태 설명에 사용한다.

필수:

- direct answer
- 필요할 때만 근거와 불확실성

금지:

- 요청하지 않은 code mutation
- 불필요한 plan artifact
- 단순 fact lookup을 위한 child fan-out

## Analyze

현재 책임, 원인, 문제와 권장을 read-only로 제공한다.

필수 schema:

```text
scope
facts[]: statement, source
problems[]: impact, evidence
recommendations[]: action, rationale, trade-off, priority
gaps[]
confidence
```

규칙:

- fact와 inference를 구분한다.
- current code/policy와 official-current evidence가 충돌하면 출처·시점·적용 범위를 설명한다.
- 권장은 구현 권한이 아니다.
- user가 plan을 요청하지 않았다면 plan file을 생성하지 않는다.

## Plan

승인 전 구현 순서와 결정 경계를 고정한다. Plan 생성은 code implementation이 아니다.

필수 schema:

```text
planId
objective / nonGoals
baseline: branch, HEAD, working tree, source inventory
facts[] / inferences[] / gaps[]
decisions[]: id, status, evidence, rejected alternative, revisit condition
openQuestions[]: impact, owner, blocking status, disposition
dependencies[]
phases[]: objective, owned files, work, tests, acceptance, stop condition
verificationMatrix[]: claim, evidence
risks[] / mitigations[]
finalAcceptance[]
```

규칙:

- dependency가 있는 Phase를 병렬 단계로 위장하지 않는다.
- 현재 결정할 수 없는 provider·account·region·production target은 release evidence handoff로 보낸다.
- OQ가 implementation blocker인지 명시한다.
- checkbox나 phase label이 아니라 observable outcome을 acceptance로 사용한다.
- plan을 작성했다는 이유로 구현을 시작하지 않는다.

## Implementation / verification handoff

Implementation은 explicit `mutate` authority가 있을 때만 시작한다. 완료 보고는 다음을 포함한다.

- Added / Updated / Deleted files
- observable behavior or responsibility change
- executed verification and actual result
- remaining blocker, risk, or verification gap

Agent의 role, plan phase, “완료” 문구는 evidence가 아니다.
