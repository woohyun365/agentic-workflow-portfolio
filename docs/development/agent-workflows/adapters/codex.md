# Codex and OMX execution adapter

## Cross-host direct CLI reviewer (static boundary)

[Codex-target bridge policy](../../../../scripts/agents/codex/review-bridge.mjs)는 승인된 Claude Lead의 추가 읽기 전용 검토를 위한 **top-level** `codex exec` 계약입니다. `gpt-6-astra`, `--sandbox read-only`, 비대화식 승인 거부와 source/config/role digest를 사용합니다. 이 프로세스가 `.codex/agents/repo_reviewer.toml`을 로드하거나 별도 필수 Astra QA를 충족했다고 주장하지 않습니다. 명령은 `enabled:false`이며 현재 bridge는 실행하지 않습니다. auth·실제 모델·sandbox·role 입증은 별도입니다. [교차 인계](./cross-model-handoff.md#direct-cli-review-bridge-static-preparation-only)를 따르며 `omx ask`로 자동 우회하지 않습니다.

이 문서는 공통 [orchestration](../orchestration.md)·[execution](../agent-execution-contract.md)·[QA](../qa.md)를 소비하는 Codex/OMX 전용 모델·effort·dispatch·복구 owner입니다. 다른 host에 자동 적용하지 않습니다. 기존 finite cohort/admission과 필수 Astra QA는 유지합니다.

Child 완료·추가 배정·capacity 오류·turn 종료 시 Parent가 [subagent lifecycle](../subagent-lifecycle.md)에 따라 결과 회수, explicit-close/verified-no-close/unknown과 slot 증거를 구별합니다. 상한은 6이며 close 미지원만으로 release 또는 실패를 단정하지 않습니다. V2 runtime-managed에서는 같은 lane 후속에 `followup_task`를 우선하며 최초 독립 QA는 fresh scoped context를 유지합니다. `/agents`는 선택적인 operator evidence이지 필수 기반이 아닙니다.

## Visual skill scope

Taste (`design-taste-frontend`)와 Redesign (`redesign-existing-projects`)은 **Codex-only** task-fit 도구이며 공통 필수 skill이나 Claude 이식 대상이 아닙니다. 기존 personal Codex 설치는 보존하고 [선택·설치 경계](../visual-design/design-task-orchestration.md#task-fit-skills)를 따릅니다. 각 skill의 discovery/qualification은 별개이고 모델의 디자인 우열을 주장하지 않습니다.

## Repository workflow entry

```sh
pnpm codex:workflow -- --request '변경 원인을 분석해줘.' --mode fresh --json
pnpm codex:workflow -- --request '지정 작업을 분석해줘.' --mode resume --plan .plans/example-plan.md --json
pnpm codex:preflight -- --fresh
```

`codex/workflow-entry.mjs`의 `prepareCodexWorkflow`는 공통 intake/context/readset → 기존 Codex delegation/dispatch 추천 → 공통 bounded lane 검증을 연결합니다. `fresh-session-smoke`도 이 caller를 소비합니다. CLI는 현재 요청의 deterministic 진단이며 provider·native agent·OMX를 실행하지 않습니다. 명시한 plan 외에 local memory를 탐색하지 않습니다.

API의 `directAssignment` 또는 선택된 child별 `assignments`, `currentSnapshot`, `adapterIdentity`는 Parent가 현재 source와 비교해 제공합니다. Missing binding은 gap이며 자동 권한이 아닙니다. `validateCodexWorkflowResults`는 원래 입력에서 계약을 다시 계산하고 common fan-in과 독립 QA exchange를 검사합니다. `reviewDisposition: { required, reason }`에 공통 QA trigger를 검토한 Lead 판단을 명시합니다. 오탈자 등 저위험 direct 작업의 `not-needed` 의미를 보존하고, disposition 누락은 gap입니다. Bounded-build의 필수 Astra QA는 면제하지 않습니다. QA가 필요하면 현재 task/owner/snapshot뿐 아니라 lane acceptance와 read/write scope에 대응하는 완료 PASS를 요구합니다. 제출된 coverage·관측 모델은 Lead가 실제 증거와 다시 대조해야 합니다. 결과 `valid`는 정적 정합성뿐입니다. 실제 호출·model/permission·finding 재현·Astra QA·종료 입증은 계속 Parent와 host의 책임입니다.

`codex:preflight`는 Codex Git/OMX snapshot 명령이며 request CLI의 alias가 아닙니다. 기본 계획 탐색은 `.plans`, 명시적 legacy `.omx/plans` 읽기만 과도기 호환입니다. `planDiscovery.complete/issues` 및 선택된 `planBinding`으로 불완전한 inventory와 잘못된 상태를 드러냅니다. Legacy reader 제거 조건은 필요한 callers와 owner-local 계획 migration 완료입니다. 파일을 자동 생성·이동하거나 runtime `.omx/context`를 옮기지 않습니다.

## Reasoning effort routing

Reasoning routing은 Parent와 child를 분리합니다. Parent effort는 사용자가 session에서 선택하며 repository는 Parent
effort를 계산하거나 변경했다고 보고하지 않습니다.

1. Pass 1은 intent, authority, impact risk, candidate shape만 정합니다.
2. Direct/deterministic work 또는 Medium child보다 직접 수행이 저렴한 work는 child-free로 유지합니다.
3. Pass 2는 current ContextPack의 source/fact/predicate evidence를 정규화하고 child role과 effort를 판정합니다.
4. 모든 boundedness predicate가 positive evidence로 확인되면 Medium, mandatory state/trust/concurrency/migration signal 또는
   structural deep composite가 확인되면 XHigh, 그 외 substantial work는 High입니다.

Repository-selected child의 기본값은 GPT-6 Astra이며 effort는 `medium | high | xhigh`를 유지합니다. Keyword, path, file count, LOC, broad verification
하나만으로 effort를 올리지 않으며 같은 fact를 여러 composite category로 중복 계산하지 않습니다. Semantic role mapping은
`repo_explorer | repo_researcher | repo_executor | repo_reviewer`를 사용하지만 role 이름 자체는 live runtime 지원 증거가
아닙니다. Fresh active-surface evidence가 없으면 runtime descriptor는 support unknown/applied false이고 실제 dispatch 전에
leader가 compatibility를 다시 확인합니다. Low와 `max/ultra`는 일반 repository child route에 사용하지 않습니다. Bound recovery invocation은 아래 별도 계약을 따릅니다. Role routing을
증명하지 못하면 역할을 prompt label로 가장하지 않고 single/sequential fallback을 사용합니다.

Runtime compatibility는 repository config나 설치 파일 존재 여부가 아니라 현재 surface가 leader에게 보고한 bounded
evidence로 판정합니다. Native surface는 current-turn host tool schema, OMX surface는 current-session runtime overlay와
host-exposed `agent_type` roster가 함께 필요합니다. 이 evidence는 leader-reported input이며 host-authenticated authority로
표현하지 않습니다. 선택 role마다 availability, 추천과 일치하는 model/effort 해석, explicit-effort support와
dispatch permission이 일치해야 합니다. Advisory descriptor가 만들어져도 `requiresLeaderRuntimeConfirmation=true`이므로
leader는 실제 child dispatch 직전에 live surface를 다시 읽고 불일치하면 sequential fallback으로 전환합니다.
첫 실행은 configuration resolution을 사용하며 실행 전 값을 effective telemetry라고 쓰지 않습니다. 실행 후 관측은 별도 검사합니다.

### Parent-high 운영과 quality stop

Owner가 **Parent Astra high**를 선택하는 운영 형태에서도 작은 작업은 직접 처리합니다. 분리 가능한 깊은 미해결 문제만
기존 semantic evidence와 active schema 확인을 거쳐 **Astra xhigh child**에 배정합니다. 전체 문제 정의·범위·cross-owner
통합이 어려우면 Parent xhigh를 권고하며, 높은 child effort가 Parent의 통합 판단을 대신하지는 않습니다.

- 적용은 관련 구현·검증·운영 handoff가 완료된 뒤 실제 host의 session control에서 선택합니다. 이 지침 추가, 설정 파일 값,
  child descriptor만으로 현재 Parent high 적용을 주장하지 않습니다. Parent/global/reviewer 설정을 자동 변경하지 않습니다.
- 첫 실제 업무에서 required tests와 [독립 QA trigger](../qa.md#independent-review-disposition)를 유지하고 acceptance 누락·
  scope 위반·substantive finding·수정/복구 원인을 기록합니다. 작은 작업마다 새 QA child를 만들지는 않습니다.
- 보안/권한/범위/데이터 invariant 위반 또는 잘못된 완료 주장이 확인되면 해당 작업의 무인 계속을 멈추고 원인·영향을 확인합니다.
  **원인을 먼저 구분한 뒤 effort를 판단**합니다. Source/환경/권한/테스트 공백부터 바로잡고, Parent의 framing·통합 추론 부족이
  의심되거나 같은 누락이 재발하면 Parent xhigh 재검토를 권고합니다. 격리 가능한 기술 문제만이면 bounded xhigh child를 씁니다.
- 상향은 원인 입증이나 품질 회복 보장이 아닙니다. 입력 부족·권한 거절·필수 독립 검증 부재를 effort로 우회하지 않습니다.
  기존 retry ceiling·QA gap 처리를 유지하고 해결 불가능하면 근거를 보존해 handoff합니다.

Ordinary Astra도 공급된 context 불일치를 dispatch consumer가 거절합니다. Supported native scoped/explicit 호출의 정확한
인자와 legacy/reuse 경계는 [context delivery](./codex-delegation.md#context-delivery)가 소유합니다. 이 경계의 회귀
검사와 실제 Parent-high 품질/사용량 관측은 별개이며, 검증되지 않은 동등 성능·weekly 절감 수치를 보고하지 않습니다.

### Quality-gated model advice

Role/effort를 먼저 판정한 뒤 선택 입력 `modelRequest`가 있을 때만 finite model 후보를 추천합니다. 입력이 없으면 기존
Astra-only compatibility와 출력이 유지됩니다. 결정적인 grep/check/list는 child 없이 도구로 처리합니다.

| Task profile      | 후보 model / invocation effort | 범위                                                                                |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `bounded-build`   | `gpt-6-sol` / xhigh            | 구현·test, 단일 write owner, acceptance·regression·독립 Astra QA                    |
| `bounded-read`    | `gpt-6-sol` / xhigh            | lookup·analysis read-only, acceptance·독립 검사. Researcher는 pilot-only            |
| `bounded-extract` | `gpt-6-luna` / xhigh           | 낮은 영향도의 고정 repository 입력·output schema·단일 semantic extraction·독립 검사 |

- Astra: Parent, 최종 QA, architecture/auth/trust/transaction/migration/concurrency, 미해결 실패·위험/품질 gap.

현재 정적 후보는 완전한 Medium boundedness, high-confidence facts, 빈 gap/domain/composite signal, non-high impact를
모두 요구하는 **보수적인 첫 cohort**입니다. Medium이라는 이유만으로 모델을 내리지 않습니다. Task/cohort/검증 fact와
write/context/runtime/admission gate도 통과해야 하며 broader High cohort는 추가 품질 근거 전까지 Astra입니다.
Luna도 semantic complete Medium을 요구하되 세 profile의 invocation effort는 xhigh입니다. Semantic 위험도와 모델별 호출 effort는 별도 축입니다. 일반 Low effort·Parent 모델 변경·일반 role을 이용한 project pin 우회는 포함하지 않습니다.

Parent는 선택 근거를 짧은 sanitized evidence reference로 남깁니다. 결정적 도구로 충분한지, semantic 작업의
목표·acceptance·입력·context가 완전한지, dependency/owner/검증 경계가 유한한지, 직접 oracle·독립 검사가 있는지,
위험·가역성·쓰기 범위가 적합한지, 해당 profile/role의 승인·실패 이력이 유효한지를 확인합니다.
파일 수·LOC·keyword 점수로 선택하지 않으며 xhigh가 재작업을 줄였다는 주장은 matched evidence 없이 하지 않습니다.
Max worker/복구, Parent·운영 reviewer 변경은 허용하지 않습니다.
[실행 기록과 원인/복구 관측](../request-intake/orchestration-recovery.md#bounded-model-run-evidence)은 선택을 기록할 뿐
semantic eligibility나 admission을 완화하지 않습니다.

현재 채택 범위와 새 세션의 선택 순서는 [Routine task-model operation](#routine-task-model-operation)을 따릅니다.
추천은 `applied=false`입니다. [정확한 request/검증 fact 계약](./codex-delegation.md#model-recommendation)과
[pilot/adoption·runtime admission](../request-intake/orchestration-recovery.md#model-admission)을 따릅니다.
별도 허용된 최초 pilot은 adoption GO 전에도 비교할 수 있지만, pilot 허용/PASS는 운영 채택 GO가 아닙니다.
Parent는 일반 bounded task에서 이 표를 소비해 적합한 modelRequest를 채웁니다. 자동 keyword classifier나 scheduler는 없습니다.
기본값/최종 QA는 Astra입니다. 실행·읽기 역할은 model pin 없이 task 선택을 받지만, 실제 loaded role에 pin이 있으면
lower model 인자로 이를 우회하지 않습니다. 설정 파일과 native 지원은 아래처럼 별도로 확인합니다.
지원된 명시적 모델·effort/scoped fork와 source/config/권한을 확인한 descriptor만 실제 native 호출에 전달합니다.
Lower-model lane은 하나씩 실행합니다. 품질/지원 불일치는 pending writer를 회수한 뒤 Astra로 최대 한 번 복귀하며,
quota/capacity/permission 거절을 모델 변경으로 우회하지 않습니다.

공식 단가의 비용 우위는 task-aware 선택의 근거입니다. 호출별 usage/weekly 측정 부재는 품질 GO/운영 채택의 차단 조건이
아니지만, 총 task 비용·weekly 절약을 측정했다고 주장할 수는 없습니다. 정적 테스트 성공도 실제 모델 사용의 증거가 아닙니다.

### Bound Astra recovery invocation

실행된 candidate의 적격 실패에는 같은 역할·쓰기 owner·도구 범위를 보존한 별도 recovery selection을 사용합니다.
`astra-bounded-recovery`는 원인과 남은 acceptance가 좁고 context·oracle가 충분한 non-high-risk 작업의 **Low invocation**이며,
ordinary modelRequest나 semantic Medium 판정을 바꾸지 않습니다. Unknown/deep/high-risk는 기존 semantic effort를 따른
`astra-standard-recovery` 또는 handoff, QA·identity·permission/quota/cap 문제는 이 경로로 우회하지 않습니다.
Pending writer 회수 후 정확한 첫 실패·현재 rescue source/config/scope·승인·예산·시간에 bind한 alternate 한 번만 가능합니다.
한 번의 Low 실패 뒤 더 높은 effort로 추가 호출하지 않습니다. 이 정적 경로의 지원은 실제 rescue 품질/운영 채택 증거가 아닙니다.
현재 routine Low 채택은 [검증된 executor cohort](../agentic-architecture-decisions.md#routine-model-adoption)에 한정합니다.
Explorer/researcher 등 미채택 역할에 helper가 Low를 추천해도 실행 GO가 아니며, Parent direct/검증된 Astra 경로 또는
새 evidence handoff를 사용합니다. Standard recovery를 강제하려고 cause·semantic effort를 조작하지 않습니다.
[Recovery selection과 admission 계약](../request-intake/orchestration-recovery.md#bound-recovery-selection-and-admission)을 따릅니다.

### Central profile migration boundary

`scripts/agents/codex/model-profiles.mjs`가 finite task profile의 model/effort/허용 role·task·도구·검증 키를 소유합니다.
Parent는 profileId를 고르고 현재 binding을 request → contract → admission → config resolution → execution report →
recovery에 연결합니다. Raw model/구형 GPT-5.6 request는 거절하며 모델별 TOML clone이나 provider adapter/scheduler를 만들지 않습니다.

미래 세대 변경은 해당 중앙 데이터와 가까운 회귀 테스트를 바꾸고 `policyRevision`을 갱신합니다. Eligibility 코드 변경도 revision을
갱신해야 합니다. Profile 전체 hash가 변경되면 source/config가 같아도 기존 승인·사후 보고·recovery binding을 재사용하지 못합니다.
설치된 registry와 정확히 비교하므로 synthetic hash나 scope digest 재계산만으로 새 모델을 허용할 수 없습니다.
현재 host/loaded role 확인 → 필요한 새 pilot·품질 GO/범위 승인 순서는 그대로입니다. 실패 시 Astra-only 또는 마지막 승인된 GPT-6
profile을 current source/config에 다시 승인해 복귀하며 retired GPT-5.6을 자동 복구하지 않습니다. Hash는 native 실행·권한 인증이 아닙니다.

세대교체·철회는 다음 순서로 재현합니다.

1. 변경 profile의 신규 dispatch를 중단하고 current registry/binding·source/config·채택 결정·미완료 writer를 확인합니다.
2. 선택된 실제 모델의 exact ID/effort/지원·품질 근거를 확인한 뒤 **중앙 profile data + 새 policyRevision**으로 변경합니다.
   Eligibility를 바꾸면 그 알고리즘도 owner이며 revision이 필요합니다. 역할별 TOML 복제나 `latest` alias로 넘기지 않습니다.
3. 기존 static/integration 회귀로 새 binding, stale grant/resolution/post/recovery 거절을 검증합니다. 검증되지 않은 미래 ID를
   실제 registry에 등록하지 않습니다. 새 모델 canary는 별도 bounded 권한·환경·독립 QA 후 채택합니다.
4. 새 채택 결정과 이번 task의 새 source/config/scope/time/budget admission을 만들고 live host를 다시 확인합니다.
   테스트의 synthetic revision은 데이터 seam 검사이지 새 모델 실행·품질 증거가 아닙니다.
5. **Data rollback도 새 revision**으로 게시하고 새 승인으로 연결합니다. 현재 validator가 installed data와 비교하는 것이지,
   과거 code와 grant를 함께 복원하는 운영자를 막는 monotonic history store는 아닙니다. Git revert만으로 옛 grant·5.6을
   되살리지 않습니다. 급한 중단은 registry/config를 바꾸기보다 아래 Astra-only 철회를 우선합니다.

Reproduction: `scripts/ci/codex-model-profiles.test.mjs`의 revision/rollback fingerprint 검사와
`scripts/ci/codex-orchestration-policy.test.mjs`의 routine withdrawal→fresh re-admission·stale binding 회귀. 실제 설정 변경 없이
fixture로 config drift/pin 복원에 대한 차단을 검증합니다. Parent/default/reviewer generation은 별도 설정·권한 결정입니다.

### Task model configuration and fresh loading

| 설정 owner                       | 계약                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `.codex/config.toml`             | child 기본 Astra/high, 상한6. Parent 모델·provider·전역 설정은 소유하지 않음 |
| `repo_executor`                   | model/effort pin 없음, 기존 workspace-write 및 단일 write owner 유지         |
| `repo_explorer`, `repo_researcher` | model/effort pin 없음, 기존 read-only 및 각 조사 책임 유지                   |
| `repo_reviewer`                   | Astra model pin, read-only, effort는 기존 evidence 판정 유지                 |

Custom agent TOML의 model/effort는 해당 필드의 explicit spawn → agents default → Parent 상속보다 우선합니다.
따라서 pin 제거는 **명시적 모델 선택을 받을 수 있는 설정**이지 기본값을 Sol로 바꾸는 조치가 아닙니다. Parent는 허용된
cohort에서 model과 reasoning_effort를 함께 명시하며, 미분류/무요청 경로는 Astra 기본값을 유지합니다.
[공식 subagent 설정](https://learn.chatgpt.com/docs/agent-configuration/subagents)

설정 변경 후 실제 dispatch 전 Parent가 수행할 확인:

1. 현재 branch/HEAD/working tree와 프로젝트 config·네 role 파일의 digest를 기록하고 예상 변경만 있는지 확인합니다.
   이름·sandbox·instructions·기본값·reviewer pin·상한은 별도로 대조합니다.
2. 실제 host의 fresh native role/schema, explicit model/effort/scoped fork 지원과 loaded 설정의 출처를 확인합니다.
   역할 설명에 model 고정 문구가 없는 것과 특정 TOML bytes가 실제 로드된 것은 같은 증거가 아닙니다.
   파일만 읽고 `configurationResolution`을 만들거나 actual model을 관측했다고 쓰지 않습니다.
3. 현재 host에서 지원되는 refresh/loaded-config 확인 수단이 있으면 사용합니다. 없다면 정확한 config SHA·검증·현재 schema·
   남은 gap을 handoff하고 정상적인 새 repository process/conversation에서 다시 확인합니다. 공식 문서에 custom-agent hot
   reload 보장이 없다는 사실은 모든 host에서 restart가 필수라는 뜻도 아닙니다. MCP reload를 role reload로 대체하지 않습니다.
4. `codex resume`은 이전 대화를 재개하면서 override를 받을 수 있지만 custom-role 재발견을 증명하지 않습니다. 새 conversation이
   필요한 경우 [정상 exit/resume와 소유 경계](../../troubleshooting/tooling/agent-thread-limit-reached.md#선택적-agents-운영과-정상-exitresume)를
   따릅니다. Parent가 현재 root를 임의 종료하거나 `/agents` 서버·별도 유료 CLI trial을 시작하지 않습니다.
5. 새 session에서도 actual native schema/설정 출처가 맞지 않으면 해당 모델 dispatch를 보류하고 Astra로 유지합니다.
   generic role·새 alias·전역 pin 변경으로 우회하지 않습니다. 지원 계약 확인과 실제 모델별 실행·독립 품질 검증은 별도 gate입니다.

[공식 설정 precedence](https://learn.chatgpt.com/docs/config-file/config-basic),
[CLI launch/resume](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
Fresh-load handoff는 source/config/현재 host 근거를 넘기는 절차이며 기존 child의 결과 회수·pending·residency를 대신하지 않습니다.
상세 자원 처리는 [Subagent lifecycle](../subagent-lifecycle.md)을 따릅니다.

Rollback은 이 역할 설정 변경의 corrective revert와 연결된 tests/docs 복원으로 한정합니다. 이전 source 구현이나 다른 owner
변경을 reset하지 않습니다. 이미 시작한 child는 설정 원복으로 종료/재설정됐다고 가정하지 않고 별도 lifecycle을 확인합니다.

## Routine task-model operation

[채택 결정과 한정된 실제 관측](../agentic-architecture-decisions.md#routine-model-adoption)의 **cohort GO**는
**개별 task 호출 승인**과 다릅니다. 승인된 일반 업무에서 Parent가 적격 profile을 선택하므로 매번 사용자에게 모델명을
다시 묻지 않습니다. 그러나 현재 작업 범위·runtime·예산·독립 QA를 생략하거나 과거 pilot grant를 재사용하지 않습니다.
운영 procedure는 model-mediated이며 script/schema만으로 task의 실제 의미나 권한을 인증하지 않습니다.

새 세션/일반 task의 cold-start 순서:

1. **현재 작업부터**: request → AGENTS → 이 owner와 현재 source/test. Branch/HEAD/diff·변경 owner·acceptance를 확인합니다.
   작은 deterministic 작업·단일 chain은 child0입니다. 분리 가능한 미해결 질문 하나에 primary owner를 배정하고
   [불필요한 중복과 독립 QA](../orchestration.md#primary-작업과-증거-재사용)를 구별합니다.
2. **Task→profile**: current Pass 2 사실에서 complete Medium·non-high impact·빈 gap과 실제 oracle/검증 계획을 확인합니다.
   구현/test는 bounded-build, 유한 repo 분석은 bounded-read, 고정 입력의 low-impact 단일 추출은 bounded-extract입니다.
   Risk/owner/의미상 복잡도가 다르거나 미채택 role이면 Astra입니다. Semantic Medium과 후보 invocation xhigh는 별개입니다.
3. **완전한 packet**: [request/context 계약](./codex-delegation.md#model-recommendation)의 `purpose=routine`, 현재
   profileBinding, scope/도구/쓰기 owner·사실/실패·acceptance·stop/return을 작성합니다. 최초 QA는 fresh source-first context입니다.
   Full history를 복사하지 않되 필요한 실패·제약을 생략하지 않습니다. Candidate의 미해결 실패는 새 lower-model task로 숨기지 않습니다.
4. **이번 호출의 admission**: [modelUseByLane](../request-intake/orchestration-recovery.md#model-admission)에 이 cohort 결정과
   현재 사용자 업무 권한을 함께 reference합니다. 현재 source/config/scope digests, bounded 시간 창과 남은 child/time budget,
   checks·cleanup을 확인해 새 adoption/go packet을 만듭니다. 원래 권한이 부족하거나 범위를 늘리는 경우에만 해당 경계를
   협의합니다. 고정 과거 pilot 예산이나 영구 grant를 일반 업무 예산으로 쓰지 않습니다.
5. **Native 확인·실행**: current host schema·loaded role·모델/effort 지원·pin·permission·context를 재확인합니다.
   `createDispatchRecommendation()`의 supported spawnArguments를 실제 도구에 전달하되 완료 packet도 함께 전달합니다.
   Role 설명·파일 bytes·과거 PASS만으로 loaded/effective를 주장하지 않습니다. 후보는 동시1/단일 writer, cap6·host 한도 유지.
   지원/권한 불명은 Astra/direct 또는 handoff이지 generic role·새 root·서버로 우회할 이유가 아닙니다.
6. **결과·독립 QA**: 반환 child/task/source와 실제 oracle/회귀·독립 결과를 대조하고 `evaluateModelExecution()`과
   [criterion별 QA](../qa.md#portable-qa-packet)로 확인합니다. Parent/default/최종 QA는 Astra이며 reviewer effort는 근거로 선택합니다.
   `prepareLeaderSynthesis()`로 failed/blocked/conflicting evidence를 보존하고 근거 없는 completed/self-PASS를 수용하지 않습니다.
7. **실패·기록·cleanup**: [bound recovery](../request-intake/orchestration-recovery.md#bound-recovery-selection-and-admission)는
   원인·identity·writer 회수·현재 rescue 권한·adopted role을 확인한 alternate 한 번뿐입니다. Usage가 없으면 null로 남기고
   [run evidence](../request-intake/orchestration-recovery.md#bounded-model-run-evidence)에 controlled fault와 실제 miss를 구분합니다.
   실제 결과 회수·pending·지원되는 cleanup·release는 [lifecycle](../subagent-lifecycle.md)로 따로 판정합니다.

### Suspension and Astra-only rollback

- 품질/지원/scope 변화 시 해당 cohort의 신규 사용을 멈추고 [admission 철회](../request-intake/orchestration-recovery.md#routine-admission-lifetime)를
  기록합니다. Scope/권한·보안·허위 완료는 [quality stop](#parent-high-운영과-quality-stop)을 적용합니다.
- Pending writer의 결과·도구·변경을 먼저 회수합니다. 현재 source로 새 Astra ordinary contract를 판정하거나 Parent가 직접 처리합니다.
  Candidate의 model 필드만 Astra로 바꾸거나 scope를 늘려 재시도하지 않습니다. Quota/cap/permission 거절은 다른 모델로 우회하지 않습니다.
- 재채택은 문제 원인과 required checks·독립 QA, current profile/host/source/config를 다시 확인한 **새** bounded admission입니다.
  단순한 config 복원이 adoption GO를 복구하지 않습니다. 설정 rollback이 정말 필요하면 정확한 권한·diff로 수행하며 현재 child가
  자동 종료/재설정되었다고 가정하지 않습니다. 여기서는 TOML을 변경하는 자동 rollback command를 만들지 않습니다.

최종 whole-change QA/통합 증거와 **Parent-high** 시작은 별도 gate입니다. 이 routine cohort 결정은 Parent 설정을 바꾸지
않으며 [Parent-high 준비·품질 stop](#parent-high-운영과-quality-stop)을 대체하지 않습니다. 단가·cache는 선택의 입력일 뿐
Parent+child+QA+수정/복구 총 비용의 절감 실측이 아닙니다. Token/weekly 수집이 없어도 품질 판정은 가능하지만 절감 숫자는
만들지 않습니다. Portfolio/전체 통합 평가는 현재 운영 계약이나 이 작은 표본과 별도로 검증합니다.

## Skill과 workflow routing

- read-only 원인/책임 분석: `$analyze`
- 공식 최신 근거 조사: `$best-practice-research`
- 요구가 모호하고 가정 금지: `$deep-interview`
- architecture/test 합의가 필요한 계획: `$ralplan`
- 한 owner 구현: solo 또는 executor
- 독립 구현 lane과 shared coordination: 실제 OMX runtime의 `$team`
- durable multi-goal completion과 resume: `$ultragoal`
- hostile E2E/회귀: `$ultraqa`
- cleanup: 계획과 회귀 보호 뒤 `$ai-slop-cleaner`
- UI 방향·비평·승인된 구현: [Visual design workflow](../visual-design/README.md); skill 호출이나 Figma 연결은 필수가 아님

Runtime이 없는 surface에서 team/ralph/ultrawork를 이름만 흉내 내지 않습니다.

## Codex/OMX permission mechanism

이 절의 `workspace-write`, Auto-review, `on-request`, `madmax` 및 실행 규칙은 **Codex/OMX host 전용**입니다.
공통 권한 원칙은 위의 source·scope·authority 계약이며, Claude Code의 native 도구/permission 검증은
[Claude Code adapter](./claude-code.md)를 따릅니다. Codex 권한 모드를 다른 host의 실제 격리로 추정하지 않습니다.

기본 권장 조합은 **workspace-write + 필요한 범위만 좁게 허용 + 지원되는 Auto-review**입니다. Auto-review는 기존
승인 요청의 검토자를 바꾸는 native 기능이지 모든 명령의 보안 검사나 업무 승인자가 아닙니다. 이미 허용된 작업은 검토를
거치지 않을 수 있고 `never`는 자동 검토 모드가 아닙니다. 지원되지 않으면 `on-request` 대안을 확인하며 몰래 full access로
전환하지 않습니다. [공식 Auto-review 문서](https://learn.chatgpt.com/docs/sandboxing/auto-review)

- 기존 broad allow가 적용되면 좁은 allow 추가만으로 그 범위가 줄지 않습니다. 예를 들어 `gh api` prefix는 repo·HTTP method를
  제한하지 않습니다. 실제 loaded scope·규칙 우선순위를 확인하고 잘못된 repo/method/host·추가 인자에 대한 negative case로
  평가합니다. 전역 shell/interpreter 허용이나 홈 전체 writable을 편의상 기본값으로 추가하지 않습니다.
  [공식 실행 규칙](https://learn.chatgpt.com/docs/agent-configuration/rules)
- 기본 reviewer policy는 유지합니다. `[auto_review].policy`는 추가 병합이 아닌 교체이므로 짧은 repository 지침을 넣어
  기존 보호를 덮어쓰지 않습니다. 개인 실행값은 로컬 설정이고, 업무 안전 계약은 이 문서가 소유합니다.
- `madmax`/sandbox bypass에서도 업무·비밀·소유권 지침은 유지되지만 Codex shell sandbox와 승인 검토가 유지된다고
  보고하지 않습니다. OS/managed policy/provider 제한은 별개입니다. 전면 접근이 불가피하면 최소 credential의 별도 격리
  환경을 검토하며, worktree를 보안 sandbox로 간주하지 않습니다.
  [공식 승인·보안 문서](https://learn.chatgpt.com/docs/agent-approvals-security)
- 문서는 `advisory-policy`, Lead/Auto-review 판단은 `model-mediated`, fixture·정적 규칙 검사는 `deterministic-static`,
  실제 host/provider 강제는 `native-runtime`으로 구분합니다. 설정 파일·parent 실행 옵션만으로 child effective permission이나
  runtime 활성화를 단정하지 않습니다. 지침·모델 reviewer 하나만으로 기술적 접근 제한을 대체하지 않습니다.

[`agent-collaboration-cases.json`](../../../../scripts/ci/fixtures/agent-collaboration-cases.json)은 보안 판단의 유한 입력 사례입니다.
정적 검사는 fixture·문서의 정합성만 증명합니다. 실제 Agent의 답변, Auto-review의 허용/거절, 접근 격리는 각각 별도 실행
evidence가 필요하며 한 종류의 PASS를 다른 종류의 PASS로 보고하지 않습니다.

## Diagnostic contract

**Codex/OMX 전용 호환 계약**입니다. 다른 host에 이 필드·CLI·OMX 설치를 요구하지 않습니다.
`pnpm codex:preflight` 또는
`node scripts/agents/codex/session-preflight.mjs --resume --plan <repository-relative-plan> --json`이 소비합니다.
기본 탐색은 공통 reader의 `.plans`이고 자동 legacy fallback은 없습니다. 명시적 `.omx/plans/...` 선택만 과도기 읽기를 지원합니다.
Source caller 전환은 local plan 파일 이동의 완료 증거가 아니며, 이동은 별도 owner receipt로 확인합니다.

기존 CLI 옵션, `schemaVersion: 1`, `resume.plan.{path,exists}`, `contextSnapshots: string[]`와 priority 출력은 유지합니다.
Fresh 모드의 `resume`은 `null`이며 notepad나 context 본문을 읽지 않습니다. `activePlans`는 canonical `.plans`의
active 상태만 포함합니다. `planDiscovery.complete/issues`는 불완전한 탐색을 드러내며, unknown·duplicate ID·종료 상태를 active로 추천하지 않습니다.
선택한 canonical 계획은 `resume.planBinding`으로 공통 lifecycle 결과를 제공합니다. 명시적 legacy read의 binding은 null이고 불명확한 metadata는 `unknown`입니다. 과거 inventory용 `unspecified`는 더 이상 출력하지 않습니다.

Resume의 추가 필드는 다음과 같습니다.

```text
resume.diagnostics
  taskId / taskIdSource: plan-id | filename-hint | unknown
  planStatus
  priority: taskMatch / freshness / reasons[]
  snapshots[]: path / taskMatch / freshness / reasons[]
  recommendedContextPath: path | null
  limitations[]
```

`snapshots`는 `contextSnapshots`와 같은 경로·순서이며 최대 5개입니다. 출력은 포인터와 고정 진단 코드만 담고
checkpoint의 objective, 요청 본문, nextAction 또는 raw notepad/JSON을 복제하지 않습니다.

| 진단                     | 의미                                                                                           | 후속 행동                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| priority `valid`         | 기존 priority JSON 구조가 파싱됨; 빈 priority의 기존 `valid: true`도 유지                      | taskMatch/freshness와 별개로 해석                                 |
| context parser `valid`   | 필수 구조·타입·금지 필드·절대 만료 검사를 통과                                                 | 현재 요청과의 동일성이나 live phase 증명은 아님                   |
| `taskMatch: matched`     | 선택한 계획 경로와 task metadata가 충돌 없이 일치                                              | 현재 code/test evidence 추가 확인                                 |
| `mismatched` / `unknown` | 서로 다른 작업 / 비교할 충분한 근거 없음                                                       | 과거 작업을 임의로 이어가지 않음                                  |
| `freshness: current`     | 알려진 비종료 계획, 절대 만료 전, 유효한 시각, 같은 branch/HEAD, clean tree와 관련 경로를 확인 | 선택 후보일 뿐 실행 허가나 정확성 보장은 아님                     |
| `needs-review`           | branch/HEAD 변경, dirty tree 또는 archived plan                                                | 관련 변경을 확인; HEAD가 다르다는 이유만으로 기억을 삭제하지 않음 |
| `expired`                | 절대 기한 도달 또는 선택한 계획이 명확히 completed/cancelled                                   | active continuation으로 추천하지 않음                             |
| `unknown`                | 잘못된/누락된 identity·시각·경로·SHA, 불명확한 계획/만료 등                                    | 부족한 정보를 재조사하고 중요한 결정만 재확인                     |

여러 사유가 있으면 `expired > unknown > needs-review > current` 순으로 판정하며 사유들은 함께 남깁니다.
`recommendedContextPath`는 검사한 후보 중 가장 최신의 `matched/current` 경로입니다. 해당 후보가 없으면 `null`이고,
priority가 항상 추천되는 것은 아닙니다. 실패한 priority와 별개의 정상 후보는 독립적으로 검사하되, 동일 경로에 대한
priority/checkpoint 충돌을 중복 제거로 숨기지 않습니다.

### Identity and freshness

- 첫 level-two section 전, fenced block 밖의 top-level `- Status:` / `- 상태:`와 `- Plan ID:`만 metadata로 읽습니다.
  상태값의 plain/backtick 표기와 세미콜론 뒤 설명을 지원합니다. `done/완료`, `진행 중`, `취소` 등의 동등 상태를
  정규화하지만 서로 충돌하거나 알 수 없는 선언은 unknown입니다. 본문/체크박스의 완료 단어로 추측하지 않습니다.
- 명시한 계획 경로가 anchor입니다. 유효한 단일 kebab-case Plan ID가 있으면 context의 `taskSlug`도 일치해야 합니다.
  Canonical `.plans`는 명시적 ID가 필요합니다. Legacy 읽기에서만 Plan ID가 없을 때 파일명에서 `.md`와 말미 `-plan`을 뺀 값을 검색 힌트로 사용합니다. 잘못되거나 충돌하는 ID를
  filename fallback으로 덮지 않습니다. `activePlan` 경로는 항상 일치해야 하며, priority `task`와 context task의 충돌도
  다른 일치값보다 우선합니다. `--plan`이 없으면 저장된 기억에서 현재 작업을 추론하거나 추천하지 않습니다.
- 이동/삭제된 계획은 missing으로 남깁니다. 전역 archive 검색, 자동 경로 재작성이나 task alias를 만들지 않습니다.
  명시적으로 선택한 `finished/` 경로는 읽을 수 있지만 active context로 추천하지 않습니다.
- `createdAt`은 파일명 UTC 초와 일치하고 미래가 아니어야 합니다. 잘못된 달력 날짜/시각 불일치는 진단합니다.
  축약 SHA는 로컬에서 유일한 commit으로 해석할 수 있어야 하며 이를 위해 fetch하지 않습니다.
- `expiresAt: on-phase-completion`에는 live phase oracle이 없습니다. 저장된 `currentPhase`, `completed`, `planStatus`나
  OMX mode만으로 현재 phase 종료 여부를 확정하지 않습니다. 선택한 계획의 명확한 종료는 expired, 그렇지 않으면
  `expiry-unknown`입니다. 동일 `workingTreeSummary`도 diff hash가 아니므로 dirty tree는 항상 재검토 대상입니다.

### Bounded reads and failure handling

- `.omx/context`는 filename만 비재귀적으로 열거합니다. 계약에 맞는 파일명과 유효한 시각을 가진 관련 task를 우선합니다.
  안전하고 구조적으로 유효한 priority 대상에 한 슬롯을 배정한 뒤, 관련 후보를 filename 시각 내림차순·동률 경로
  오름차순으로 채웁니다. 누락된 priority 경로도 진단하며, 본문은 총 5개 이내로 검사하고 실패 슬롯을 재충전하지 않습니다.
- 검증된 `createdAt` 내림차순으로 결과를 정렬하고 유효하지 않은 시각은 뒤에 둡니다. 관련 없는 검색 후보의 본문은
  읽지 않습니다. `candidate-limit`은 검색이 부분적임을 뜻하며 과거 기억 전체를 조사했다고 주장하지 않습니다.
- Plan/context는 lexical 및 realpath containment, symlink·owner-directory·일반 파일 여부를 확인하고 파일당 64 KiB까지만
  읽습니다. 관련 파일은 경로/존재만 확인합니다. 안전하지 않은 `--plan`은 CLI 오류, 선택적 context 문제는 진단 gap입니다.
- 선택적 OMX 호출은 각각 5초·64 KiB로 제한합니다. 실패·malformed·oversized 결과는 `omx-unavailable` 등으로 표시하며
  정상적인 fresh 조사 자체를 차단하지 않습니다. `plan-metadata-unknown`, `identity-conflict`, `context-invalid`,
  `unsafe-path`, `head-changed`, `dirty-tree` 등은 조사 이유이지 state 변경 명령이 아닙니다.
- Preflight는 `.omx/state`, notepad, checkpoint, 전역 설정을 쓰거나 정리하지 않습니다. 자동 실행/dispatch 권한도 없습니다.

## OMX 종료 기록 경계

**Codex/OMX에서만:** `omx_wiki/`는 명시적으로 승격한 재사용 지식만 소유합니다. 세션 종료 메타데이터는 repository
`.omx-config.json`의 `wiki.autoCapture: false`로 자동 생성하지 않으며, `session-log-*.md`는 Git 방어선에서도
제외합니다.
