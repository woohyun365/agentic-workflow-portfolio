# Independent lane and child task contract

한 task에는 하나의 write owner만 둡니다. 위임은 선택적·advisory이며 자동 child 생성이 아닙니다. Lead가 배정·scope 변경·통합·최종 QA·중단 판정을 소유합니다. 최초 독립 검토자는 source와 인수 기준을 받되 builder의 reasoning은 받지 않습니다. Finding은 재현 전까지 가설입니다. 통신은 [Owner–Lead collaboration](../owner-lead-collaboration.md)을 따릅니다.

역할·모델·effort·admission·runtime·lifecycle은 [현재 host adapter](../adapters/README.md)를 선택합니다. 기존 `recommendDelegation()` schema와 구현은 [Codex/OMX child policy](../adapters/codex-delegation.md)가 소유하며 Claude나 제3 host의 매개변수가 아닙니다.

## Single-first gate

직접 답변·deterministic 작업, 미해결 권한·모호함, 의존 작업, 겹친 write ownership 또는 source 기반 독립 검증이 없는 lane에는 child 0을 사용합니다. 독립적이고 bounded된 읽기·검토는 child 하나여도 유용할 수 있습니다. 남는 agent 수를 채우기 위해 fan-out하지 않습니다.

## Independence predicate

Lane의 bounded objective·read scope·write owner·expected output·verification·stop/handoff가 다른 lane의 결과 없이 충족될 때만 독립적입니다. 읽기 전용 lane은 같은 source를 볼 수 있지만 policy → contract → implementation은 순차입니다. Lead는 dispatch 전에 현재 host capability를 확인합니다.

## Candidate schema

공통 task/QA handoff는 objective·source snapshot·허용 evidence/tool·읽기/쓰기 범위·non-goal·금지 assumption·expected result·verification·stop condition·Lead ownership을 식별합니다. 이 필드는 provider role/model을 지정하지 않습니다. Codex-only `modelRequest`·Pass 2·role data는 [Codex candidate schema](../adapters/codex-delegation.md#candidate-schema)를 따릅니다. 검토 packet은 [QA owner](../qa.md#portable-qa-packet)를 재사용합니다.

## Model recommendation

공통 모델·effort 기본값은 없습니다. [Codex model recommendation](../adapters/codex-delegation.md#model-recommendation)은 host 정책입니다. Claude·제3 host도 자신의 adapter와 현재 admission 증거로 판정하며, 정적 설정을 실제 적용으로 보고하지 않습니다. 미등록 host에 Codex 기본값을 대입하지 않습니다.

## Context delivery

최소한이되 완전한 source-bound packet을 전달합니다. 알려진 실패·제약은 보존하고 최초 독립 reviewer에게 builder reasoning은 전달하지 않습니다. 재사용에는 최신 snapshot·ownership 확인이 필요합니다. Codex의 fork·reuse·explicit-effort는 [Codex context delivery](../adapters/codex-delegation.md#context-delivery)에서만 적용하며 공통 packet이 그것을 실행하지 않습니다.

## Role and effort

조사·연구·구현·독립 검토는 공통 책임이고 concrete role ID·설정·effort는 host별입니다. [Codex routing](../adapters/codex-delegation.md#role-and-effort)과 [Claude Code guidance](../adapters/claude-code.md)도 실제 host 지원과 대조해야 합니다. Prompt label은 capability를 부여하지 않습니다.

## Count와 write policy

Single-first와 one-writer는 공통 제약입니다. 근거 있는 독립 lane만 선택하고 현재 host의 cap을 지킵니다. [Codex fan-out limits](../adapters/codex-delegation.md#count와-write-policy)를 Claude·제3 host에 자동 상속하지 않습니다. 미지원 선택적 위임은 허용된 직접 작업으로 제한하지만 필수 독립 QA·권한 증거 부족은 gap으로 남깁니다.

## Ownership boundary

Child는 evidence·gap·blocker를 Lead에게 반환하며 배정·승인·write scope를 변경하거나 최종 완료를 판정하지 않습니다. Intake·공통 packet 검증·host recommendation은 advisory로서 child를 실행하거나 provider 권한을 부여하지 않습니다.

### Recovery child context

Recovery에는 새로운 bounded 결정·최신 snapshot·실패 evidence·동일 owner/scope 경계가 필요합니다. [공통 recovery budget](./decisions.md#aipo-010--recovery는-한-번의-alternate-attempt)은 해당 ordinary recovery route에 한정하며 전체 구현의 test-fix 횟수 제한이 아닙니다. [Codex recovery child context](../adapters/codex-delegation.md#recovery-child-context)의 host-only binding을 다른 host 기본값으로 번역하지 않습니다. 권한·scope 거절을 재호출이나 다른 provider로 우회하지 않습니다.
