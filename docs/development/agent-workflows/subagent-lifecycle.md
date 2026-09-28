# Parent-owned subagent lifecycle

결과 회수·writer 소유권·검증 의무는 host 공통입니다. 아래 `agent thread limit reached`, native close capability와
OMX Team 절차는 Codex/OMX runtime에 한정합니다. Claude Code의 실제 subagent 종료·permission 동작은
[Claude Code adapter](./adapters/claude-code.md)와 현재 host 관측으로 판정하고, 이 절차를 그대로 이식하지 않습니다.

Parent가 child 작업 완료 후 결과 회수·capability별 cleanup 판정·자원 관측과 `agent thread limit reached` 복구를 소유합니다.
호출 거절만 보고 종료하지 않고, 실제 지원 계약 안에서 안전한 정리와 bounded 대안을 선택합니다. 새 scheduler나 runtime hook을
구현하는 문서가 아닙니다. 배정/권한은 [Orchestration](./orchestration.md), 독립성은 [QA](./qa.md)를 따릅니다.

## Trigger와 고정 경계

- child 작업 완료/final result 도착, fan-in 완료, 추가 dispatch 전, capacity error 발생, parent turn 종료 시 확인합니다.
- repository child 상한 6 및 현재 runtime의 더 엄격한 제한을 유지합니다. 설정 증액·새 session/외부 agent를 만드는
  상한 우회는 복구가 아닙니다. Runtime이 허용한 dispatch만 실행하며 과거 roster 길이로 잔여 슬롯을 계산하지 않습니다.
- 현재 session의 실제 tool schema와 fresh status를 확인합니다. 문서에 close가 설명되어 있거나 CLI가 설치돼 있다는
  사실만으로 지금 호출 가능한 기능이라고 단정하지 않습니다.
- native thread, OS process, 저장된 session, OMX Team task는 다른 자원입니다. 각 owner의 lifecycle을 혼용하지 않습니다.

## 상태와 책임 경계

| 영역                   | 관찰과 책임                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Task/turn              | Parent가 배정한 작업의 결과·실패·pending을 회수한다. `completed`만으로 다음 영역의 완료를 주장하지 않는다.        |
| Runtime residency      | resident/unloaded와 슬롯 회수는 runtime 소유다. 관측하지 못하면 unknown이며 결과 회수와 별개다.                   |
| Persistent session     | 저장된 대화·identity·재개 가능성은 session storage 계약이다. 목록에서 안 보인다고 삭제된 것은 아니다.             |
| Operator control plane | root/client/shared daemon·worktree의 수명과 소유권이다. Child 완료를 근거로 다른 root나 daemon을 종료하지 않는다. |

## Capability 확인과 tool family

공식 기능 설명, 로컬 설정/설치, 현재 호출 가능한 schema, 실제 호출 결과를 별도 evidence로 기록합니다.
이 지침은 native tool을 생성하지 않습니다. 문서의 이름을 alias로 등록하거나 없는 함수를 추측해 호출하지 않습니다.

- **지원 surface:** [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)와
  [공식 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference)는 close를 포함한 안내를 제공합니다.
  [Responses API](https://developers.openai.com/api/docs/guides/responses-multi-agent)의 followup/message 계열과
  [Codex rust-v0.155.1의 V2 schema](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L181-L352)에는 명시적 close/resume pair가 없습니다.
  공식 페이지·설치 tag·실제 노출 schema를 구분하며 도구 이름만으로 host 구현·설정 로딩·미노출 원인을 단정하지 않습니다.
- **한도 의미:** active turn, resident 수, open thread 수는 서로 다른 계약입니다. historical roster 길이는 슬롯 계수가
  아닙니다. 공식 기본값을 repository child 상한 6이나 더 엄격한 현재 host 제한보다 우선하지 않습니다.
- **Version-specific 예:** rust-v0.155.1의 `agents.max_concurrent_threads_per_session`은 child 수이고 V2 table 값은
  root 포함 수입니다. child cap 6을 유지하려고 같은 숫자를 복사하지 않습니다. 해당 tag에서는 V2 table 값이 우선합니다.
  [cap resolution](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/config/mod.rs#L2715-L2728)
  또한 `multi_agent_v2=false`는 V1 강제 설정이 아닙니다. Model metadata에 따른 선택이 가능하므로 table 존재/flag만으로
  실제 mode를 확정하거나 설정을 변경하지 않습니다.
  [mode selection](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/config/mod.rs#L1552-L1593)
- **Source와 실행 구분:** 해당 tag의 [residency 구현](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/agent/control/residency.rs#L80-L238)은 capacity pressure에서 eligible resident를 회수합니다.
  terminal이어도 active turn/mailbox가 남으면 조건이 다릅니다. 이 구현의 존재나 completed 표시가 현재 host의 적용·실제
  슬롯 반환 증거는 아닙니다. 한 번의 cap 오류를 eviction bug로 단정하지 않습니다.

아래는 **해당 이름과 동작이 current schema에 있을 때**의 선택 기준입니다. 다른 family와 이름/인자를 임의 치환하지 않습니다.

| 목적                    | 제공되는 기능                | Parent가 확인할 의미                                                                        |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 독립 새 작업            | `spawn_agent`                | 새 context 비용/독립성이 필요한 bounded lane에만 사용                                       |
| 실행 중 사실 전달       | `send_message`               | 메시지만 전달, idle child를 깨워 작업시키는 용도로 사용하지 않음                            |
| 기존 lane 후속 작업     | `followup_task`              | 기존 non-root에 task 부여, idle이면 turn 시작; 실행 중 전달 시점은 schema 확인              |
| 다른 family의 후속 입력 | `send_input`                 | interrupt 옵션·turn 시작 여부는 해당 schema 확인, `send_message`와 동일하다고 가정하지 않음 |
| 결과 대기/상태 조회     | `wait_agent` / `list_agents` | mailbox 알림인지 결과 반환인지 구분; 조회 목록이 실제 슬롯 계수라는 보장은 없음             |
| 작업 중단               | `interrupt_agent`            | turn 중단과 context 보존; close 대용이 아님                                                 |
| child 재개              | `resume_agent`               | 노출된 경우에만 schema의 eligible 상태·identity·권한 확인 후 사용                           |
| thread 종료             | `close_agent`                | 아래 완료 절차를 충족한 대상만 종료, 반환 근거를 따로 기록                                  |

## V1/V2 lifecycle 분기

[OpenAI plugins의 Codex 도구 안내](https://github.com/openai/plugins/blob/33bd9529725fcee78c9e51fcbaa93cd963c3a47b/plugins/superpowers/skills/using-superpowers/references/codex-tools.md)는
V2에 `close_agent`가 없고 완료 child는 필요 시 runtime이 자동 eviction한다고 설명합니다. 같은 작업의 후속은
`followup_task`가 evicted child를 재로딩하여 turn을 시작하는 경로입니다. 이는 저장 대화 삭제가 아닙니다.
실제 session의 tool list/schema를 우선하고, upstream의 preset·model·fork 설명을 현재 host에 무조건 적용하지 않습니다.

- **V2 runtime-managed:** 적용 가능한 lifecycle 안내와 현재 followup/message tool schema를 대조하여 계약을 식별합니다.
  이 계약에서 close 부재는 정상이며 명시적 close 의무는 `not-required`입니다. 별도 close 응답이나 내부 eviction telemetry를
  얻으려고 없는 도구를 호출하지 않습니다. 완료된 child를 닫지 않았다는 이유로 추가 token 비용/누수/용량 점유를 단정하지 않습니다.
- **V1 explicit-close:** 현재 schema가 지원하는 close를 소유·결과 회수·terminal/pending 조건 확인 뒤 수행합니다.
  V2의 no-close 규칙을 V1의 지원 cleanup 생략 근거로 사용하지 않습니다.
- **계약 미확정:** close 하나의 부재만 보고 V2라고 확정하지 않습니다. 가능한 후속/조회 schema와 source 계약을 대조하고
  불일치는 해당 기능의 gap으로 둡니다. 내부 telemetry가 안 보이는 것과 명시적 close 의무가 없는 것은 다릅니다.
- `release-unverified`는 특정 child의 자원 반환을 관측하지 못했다는 뜻이며 정상 후속 배정의 전역 차단 사유가 아닙니다.
  새 dispatch/followup의 실제 수용·거절을 기록합니다. 성공도 어느 child가 evict됐는지 또는 모든 슬롯이 비었는지의 증명은 아닙니다.
- `/subagents`의 누적 대화 목록은 현재 resident 슬롯 수가 아닙니다. 완료/idle 표시와 실제 runtime capacity를 분리하며
  한 번의 spawn/followup 실패를 전체 child의 재사용 불가로 확대하지 않습니다. roster 부재도 삭제·영구 재사용 불가 증거가 아닙니다.

**app-server protocol V2와 model-facing multi-agent V2는 다른 계층입니다.**
[고정 protocol schema](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json)의
`CollabAgentTool`에 있는 `closeAgent` enum은 현재 모델의 도구 노출 증거가 아닙니다. Protocol/event 표현을 실행 가능한
native function으로 치환하지 않습니다. 현재 호출 가능한 tool schema가 최종 실행 경계를 결정합니다.

## 후속 작업과 fan-in

Context 크기와 fork 선택은 [context delivery 계약](./adapters/codex-delegation.md#context-delivery)을 소비합니다.
그 추천의 `reuseTarget`은 종료/재개 권한이 아니며, 아래 live identity·pending·결과 귀속을 따로 확인합니다.
Full-history 전달이나 effort 적용을 config 파일/이전 성공만으로 주장하지 않습니다.

1. **재사용 판정:** 같은 bounded outcome의 보완·finding 수정 확인이고 기존 context가 유효하면 같은 lane의 후속은 `followup_task`를 우선합니다.
   V2 자동 eviction은 새 implementer를 만들어야 한다는 근거가 아니며 지원되는 재로딩을 사용합니다. unrelated task나 최초 독립 QA는 fresh scoped context를 사용하고 재사용하지 않습니다. 이전 builder를 reviewer로
   바꾸거나 결과를 이미 본 reviewer를 새로운 독립 판정이라고 하지 않습니다. [QA](./qa.md)의 독립성 계약은 그대로입니다.
2. **정확한 대상·작업:** current owned non-root ID·상태·이전 결과를 확인하고 새 task ID, source snapshot, acceptance,
   read/write scope, 종료 조건을 전달합니다. 이는 task evidence이지 새 권한이 아닙니다. stale roster의 completed만으로
   재사용하지 않으며 pending 작업과 충돌하는 두 번째 writer를 시작하지 않습니다. 현재 조회되는 적합한 대상부터 선택하고,
   미조회 target의 복원은 아래 cold-resume 근거로 판단합니다. 실패한 과거 ID를 현재 조회된 대상처럼 기록하지 않습니다.
3. **전달과 시작 구분:** `send_message`는 새 turn을 시작하지 않습니다. idle child의 답변/작업이 필요하면
   `followup_task`로 existing non-root에 배정합니다. 실행 중 child에는 관련 사실만 메시지로 전달하고,
   범위 변경·중단은 Parent가 명시하여 승인된 assignment 안에서 처리합니다. `send_input`만 있으면 그 schema를 따릅니다.
   완료된 child에게 감사 인사만을 위한 메시지를 보내지 않습니다. 불필요한 mailbox 작업이나 새 turn을 만들지 않습니다.
4. **fan-in:** 응답의 accepted/queued는 완료가 아닙니다. `wait_agent` timeout도 작업 완료 증거가 아님을 유지하고,
   긴 bounded wait 후 실제 mailbox result를 회수합니다. 상태 알림만 반환한 surface에서는 알림 자체를 결과로 사용하지 않습니다.
   이전 final을 새 task의 완료로 재사용하지 않으며 task/target/snapshot과 결과를 대조합니다. 불명확하면 재확인하고 gap을 남깁니다.
5. **중단·재배정:** interrupt 응답은 진행 중 외부 도구의 취소·side effect rollback을 보장하지 않습니다.
   writer 재배정 전에 pending 도구/process와 파일 상태를 확인합니다. 정확히 소유한 취소가 승인된 작업만 지원 기능으로 중단하며,
   슬롯 확보용 interrupt는 하지 않습니다. child resume 성공도 새 task의 실행/완료 증거와 구분합니다.
6. **완료·한도:** 후속 결과 회수 뒤 아래 완료 절차로 돌아갑니다. 재사용은 cap 우회가 아님을 유지하고,
   follow-up/resume도 runtime 거절을 받을 수 있습니다. 실패하면 아래 동일 recovery ceiling을 소비하며 이름을 바꿔 반복하지 않습니다.

## Capability별 완료 판정

| 적용 계약           | Parent의 판단                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explicit-close`    | 소유·terminal·권한·결과 회수·pending 확인 후 지원 close가 필요하면 수행한다. Close와 release 증거는 별개다.                                                     |
| `verified-no-close` | 현재 host에 적용되는 runtime-managed 계약과 close 미지원 및 같은 안전 조건을 확인했다면 명시적 close 의무는 `not-required`다. 추가 정리 명령을 발명하지 않는다. |
| `unknown`           | 계약·대상·pending 등의 미확인을 그대로 남긴다. 결과 회수 성공과 미확인 cleanup을 구분하고 unsafe action을 추천하지 않는다.                                      |

`close=false`만으로 자동으로 `not-required`가 되지는 않습니다. 로컬 flag나 protocol enum만으로 적용 계약을 채우지 않습니다.
위 V1/V2 분기의 적용 가능한 안내와 실제 tool schema를 대조해 runtime-managed로 판정했다면 별도의 close/eviction 성공
관측을 그 판정의 선행 조건으로 요구하지 않습니다. 작업 결과를 회수해도 자원 반환을 관측하지 못했다면 `release-unverified`입니다.

기존 [순수 evaluator](../../../scripts/agents/codex/orchestration-policy.mjs)의 출력은 다음을 분리합니다.

| 출력                 | 의미                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `resultDisposition`  | 해당 task의 final을 회수했는지: collected / uncollected / unverified. 회수됐어도 pending work는 남을 수 있다.            |
| `cleanupDisposition` | 명시적 정리 의무: required / not-required / satisfied / unknown.                                                         |
| `closeDisposition`   | not-attempted / closed-confirmed / close-unverified / cleanup-unavailable / cleanup-failed. 실패는 재시도 허가가 아니다. |
| `releaseDisposition` | release-confirmed / release-unverified. 같은 child/task에 귀속되는 별도 반환 관측이며 close 없이도 보고될 수 있다.       |

선택형 `lifecycleContract`의 cleanup·verification·reference는 Parent 보고값일 뿐 host 인증이나 권한을 생성하지 않습니다.
`pendingMailbox`의 null·누락을 0으로 간주하지 않습니다. pendingTasks/pendingTools와 함께 실제 증거로 확인하며, 기존 입력을
읽을 수 있다는 사실이 cleanup/continuation 허가를 뜻하지 않습니다. 이미 release가 보고된 대상도 자동으로 다시 close하거나
continuation하지 않고 현재 접근·상태를 재확인합니다. 별도의 일반 role dispatch가 cleanup gap만으로 전부 차단되는 것은 아닙니다.

`interrupt_agent`는 실행 중 turn의 중단이지 thread 종료/슬롯 해제 증거가 아니다. 일반 `completed`나 UI의 Done 표기도
마찬가지입니다. `archive`가 현재 native thread의 `close`와 동등하다고 추측하지 않습니다. 다른 API의 유사 이름이나
saved-session UUID를 native child ID로 임의 매핑하지 않습니다.

## 완료 시 절차

1. **결과 보존**: final result, source snapshot, 실행 evidence, 미해결 finding/gap을 parent가 회수하고 통합합니다.
   필요한 요약/포인터만 task artifact에 남기며 secret·긴 transcript를 복사하지 않습니다. 아직 결과가 없으면 먼저 회수합니다.
2. **대상 재확인**: current parent에 속한 정확한 child ID, 현재 terminal 상태, pending follow-up/도구/mailbox 작업 없음,
   결과 회수 완료를 fresh runtime으로 확인합니다. 이름·cwd·과거 로그만으로 소유를 증명하지 않습니다.
   running/waiting/unknown 대상은 슬롯 확보만을 위해 닫지 않는다. 다른 parent·다른 session·Team 대상도 건드리지 않습니다.
3. 보존이 필요하면 `retained-with-reason`에 reason과 revisit를 기록합니다(예: 특정 수정의 delta review 뒤 종료).
   V1의 명시적 close를 미룰 때 막연한 “나중에 재사용”은 무기한 보존 사유가 아닙니다. V2에는 저장된 완료 대화 자체를
   없애야 하는 close 의무가 없으며 보존 사유를 꾸며 내거나 자동 eviction을 수동 실행하지 않습니다. 같은 reviewer 재사용은 최초 context-isolated review 뒤
   그 finding의 delta 확인에 한정할 수 있으며 builder를 독립 reviewer로 바꾸는 방법은 아닙니다.
4. **Capability 분기**: 위 판정표를 적용합니다. `explicit-close`이면 **지원 close 호출**: 보존할 이유가 없는 eligible child를 지금 노출된 native close 기능으로 정확한 ID만
   종료합니다. 예를 들어 `close_agent`가 실제 schema에 있을 때만 그 schema대로 호출합니다. 실행 직전 identity/status가
   바뀌거나 지원/권한이 불명확하면 mutation을 중단하고 `cleanup-unavailable`을 기록합니다. 일상적인 authorized close를
   사용자에게 대신 시키거나 허가를 다시 묻지 않습니다. 이 지침 자체가 새 종료 권한을 부여하지는 않습니다.
   `verified-no-close`이면 결과·pending·적용 계약을 기록하고 추가 native mutation 없이 반환합니다. `unknown`이면 gap을 남기고
   no-close 정상 계약 또는 실제 정리 성공으로 승격하지 않습니다.
5. **해제 확인**: 응답과 fresh status/capacity를 대조합니다. close와 release를 따로 기록하며 관측하지 못한 필드는
   `release-unverified`입니다. 후속 필요 dispatch가 성공하면 그 성공만 기록합니다. 성공 하나를 과거 모든 thread가
   해제됐다는 증거나 특정 thread의 slot 반환 증거로 바꾸지 않습니다. 시험용 dummy child는 생성하지 않습니다.

## Capacity error 복구

1. 오류가 난 실제 operation/target과 응답, 현재 tools/roster/status를 한 번 수집합니다. V2에서 close 부재를 오류 원인으로 단정하지 않습니다. 실패 응답에 유효한 child ID가
   없으면 생성 성공으로 등록하지 않습니다. 반대로 pending/부분 성공이면 runtime 결과를 먼저 확인해 중복 spawn을 피합니다.
2. V1은 위 절차로 완료·회수된 **현재 소유 child만** 지원 close 대상으로 판정합니다. V2는 결과/pending을 회수하고
   runtime-managed 계약을 적용하며 수동 close 없이 적합한 기존 lane의 재사용을 검토합니다. 재사용 중인 lane, 진행 중 작업, 소유 미확인 대상은 보호합니다.
3. V1 close 성공, 새 capacity, 유효한 현재 target/후속 경로 확인 등 실제 대안 근거가 있으면 필요한 post-cleanup dispatch를 최대 1회 재시도합니다.
   V2 재사용도 동일 one-alternate ceiling을 따르되 존재하지 않는 close 성공을 선행 조건으로 요구하지 않습니다.
   이것은 [Recovery ceiling](./request-intake/orchestration-recovery.md#recovery-ceiling)의 distinct alternate 한 번을
   소비합니다(`approachId: post-cleanup`, `alternateOf: 원래 시도`). 같은 상태의 spawn/follow-up 반복 재시도는 금지합니다.
4. 선택한 실제 대안도 실패하거나 적합한 target/후속 경로가 없으면 같은 호출 대신 parent의 안전한 sequential
   작업을 계속합니다. 현재 존재·권한·상태가 확인된 child의 bounded 재사용은 실제 runtime이 허용하고 작업/독립성 계약에
   맞을 때만 대안입니다. cleanup 후 retry, 재사용, 별도 reviewer를 차례로 모두 시도하는 무제한 ladder는 만들지 않습니다.
5. 독립 review가 필수이면 self-review로 독립 검토를 대체하지 않습니다. 실제 지원·권한이 확인된 fresh-context surface가
   있을 때만 같은 alternate budget 안에서 [QA packet](./qa.md#portable-qa-packet)을 전달합니다. 상한 우회 목적의 외부
   CLI/session spawn은 금지합니다. 대안도 실패/없음이면 안전한 로컬 검증만 마치고 independent-review gap과 필요한 기능을
   보고합니다. 그 상태를 merge-ready로 표현하지 않습니다.

권한·credential·외부 production 거절은 capacity error로 재분류하지 않습니다. Runtime DB/SQLite·session JSON 수동 수정은
금지하며 transcript 삭제, 전역 process kill, 임의 Team shutdown/cancel, 설정 증액도 복구 수단으로 사용하지 않습니다.
지원이 없는 종료를 shell/internal endpoint 추측으로 우회하지 않습니다. 환경/도구 지원이 실제로 바뀐 후 새 요청에서
재판정할 수 있지만 같은 turn에서 새 task 이름으로 retry ceiling을 초기화하지 않습니다.
Cap/quota 오류에 대한 root rollover를 우회 수단으로 사용하는 것은 금지합니다. 다른 outcome의 정상적인 새 session handoff와
슬롯 확보용 새 root 생성은 다르며, 새 root마다 child6을 만들 수 있다는 가정으로 비용·ownership 경계를 회피하지 않습니다.

## Cold resume 경계

rust-v0.155.1에는 [cold-root restart 이후 lazy reload/followup 회귀](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/tests/suite/multi_agent_resume.rs#L168-L712)가 있습니다.
따라서 cross-process 복원이 원천 불가능하다고 단정하지 않지만, 현재 host의 복원 성공도 보장하지 않습니다.
목록에 없는 child는 `not-observed`이며 삭제·영구 소실·슬롯 반환으로 단정하지 않습니다.

저장된 ID만으로 재사용하지 않고 정확한 parent/child identity·role·권한·snapshot, 현재 지원된 접근 경로와 pending을
재확인합니다. 접근 근거가 불명확하면 gap으로 남기며 global history/DB를 탐색해 ID를 추측하거나 권한을 복구하지 않습니다.
Parent의 정상 exit/resume과 daemon 운영은 [선택적 operator 절차](../troubleshooting/tooling/agent-thread-limit-reached.md#선택적-agents-운영과-정상-exitresume)를 따릅니다.

## Parent closeout

최소 기록: `child ID / parent scope evidence / 결과 회수 / cleanup 계약·의무 / close tool+result / release evidence / last status /
retained reason+revisit / next action`. task-local artifact/checkpoint에 기록하되 hidden runtime state를 대신하지 않습니다.

모든 시작한 child는 결과 회수 및 capability에 맞는 closure disposition을 가져야 합니다. V2 runtime-managed는 `not-required`로
인계할 수 있으며 close 미노출만을 이유로 `cleanup-unavailable`로 내리지 않습니다. 실행 중 child가 있으면 대기/명시된 진행 소유자를
남기고 완료라고 하지 않습니다. 검증된 `not-required`는 슬롯 반환 증거가 아닙니다. `cleanup-unavailable`도 “모두 정리됨”이
아닙니다. 지원·계약이 바뀌면 현재 eligible 대상만 재판정하며 제품 검증·작업 결과·자원 관측의 공백을 분리해 보고합니다.

문서 계약 검사는 링크/불변 규칙의 퇴행을 잡을 뿐 native runtime 실행·슬롯 반환·agent의 지침 준수를 강제하지 않습니다.
진단 예시는 [Thread limit troubleshooting](../troubleshooting/tooling/agent-thread-limit-reached.md)을 참고합니다.
